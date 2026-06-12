import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import { selectRollbackTarget } from '../../lib/lifecycle/rollback.js';
import { computeDiff } from './diff.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface RollbackOpts {
  to?: string;
  backupDir?: string;
  reactivate?: boolean;
  yes?: boolean;
}

/**
 * Ordering contract (plan dt-r1-02 — NEVER restore before confirm):
 *   1. fetch current → 2. safety snapshot → 3. select target (snapshot from
 *   step 2 excluded) → 4. diff preview → 5. confirm / --yes → 6. restore →
 *   7. verify → 8. optional --reactivate.
 * --dry-run stops after step 4 and writes nothing (not even the snapshot).
 */
export async function rollbackHandler(
  factory: Factory,
  opts: RollbackOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();
  const backupDir = path.resolve(opts.backupDir ?? '_backups');

  // 1. Current state (also proves the workflow exists before we touch disk).
  const current = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);

  // 2. Safety snapshot (skipped under --dry-run: zero side effects).
  let snapshotPath: string | null = null;
  if (!factory.flags.dryRun) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = current.name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
    snapshotPath = path.join(backupDir, `${slug}_${id}_${ts}-pre-rollback.json`);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(snapshotPath, JSON.stringify(current, null, 2), 'utf8');
    factory.io.stderr.write(`${c.dim('→')} safety snapshot → ${snapshotPath}\n`);
  }

  // 3. Target selection — the just-written snapshot is explicitly excluded
  //    so "latest backup" can never resolve to the state we are leaving.
  const target = await selectRollbackTarget(backupDir, id, {
    to: opts.to,
    exclude: snapshotPath ? [snapshotPath] : [],
  });

  let targetWorkflow: Workflow;
  try {
    targetWorkflow = JSON.parse(await fs.readFile(target.file, 'utf8')) as Workflow;
  } catch (err) {
    throw new ValidationError(`Cannot parse rollback target ${target.file}: ${(err as Error).message}`);
  }

  factory.io.stdout.write(
    `${c.bold('Rollback target:')} ${target.file}\n` +
      `  ${c.dim(`modified ${target.mtime.toISOString()} — newest of ${target.candidates.length} candidate(s)`)}\n`,
  );

  // 4. Diff preview (current → target).
  const changes = computeDiff(current, targetWorkflow);
  if (changes.length === 0) {
    factory.io.stdout.write(`${c.green('✓')} target is identical to the current state — nothing to roll back\n`);
    return;
  }
  factory.io.stdout.write(`\n${c.bold('Changes that will be applied')} (current → target):\n`);
  for (const change of changes) {
    const icon =
      change.kind === 'added' ? c.green('+') : change.kind === 'removed' ? c.red('-') : c.yellow('~');
    factory.io.stdout.write(`  ${icon} ${change.path}: ${change.summary}\n`);
  }

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `\n${c.yellow('[dry-run]')} would restore ${id} from ${path.basename(target.file)} (${changes.length} change(s))${opts.reactivate ? ' + reactivate' : ''}\n`,
    );
    return;
  }

  // 5. Confirm gate. Non-TTY without --yes fails CLOSED — rollback overwrites
  //    production state and must never proceed on silence.
  if (!opts.yes) {
    if (!factory.io.isTTY) {
      throw new ValidationError(
        'Rollback requires confirmation — pass --yes in non-interactive mode',
        `Target: ${target.file}`,
      );
    }
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Restore workflow ${id} ("${current.name}") from ${path.basename(target.file)}?`,
        default: false,
      },
    ]);
    if (!confirm) {
      factory.io.stderr.write(`${c.yellow('cancelled')} — snapshot kept at ${snapshotPath}\n`);
      return;
    }
  }

  // 6. Restore (4-field whitelist payload only).
  const body = stripReadOnlyFields(targetWorkflow);
  const restored = await client.put<Workflow>(`/workflows/${encodeURIComponent(id)}`, body);

  // 7. Verify: re-read and compare against the target we meant to apply.
  const after = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);
  const residual = computeDiff(after, targetWorkflow);
  if (residual.length > 0) {
    factory.io.stderr.write(
      `${c.yellow('warning')}: post-restore state still differs from target in ${residual.length} place(s) — inspect with: n8nctl workflow diff ${id} ${target.file}\n`,
    );
  }

  factory.io.event(
    'workflow-rolled-back',
    { workflowId: id, target: target.file, snapshot: snapshotPath, residualDiffs: residual.length },
    `${c.green('✓')} rolled back ${c.bold(id)} "${restored.name}" ← ${path.basename(target.file)}`,
  );
  factory.io.stdout.write(
    `${c.green('✓')} rolled back ${c.bold(id)} (snapshot of the previous state: ${snapshotPath})\n`,
  );

  // 8. Optional reactivate (explicit flag = explicit consent).
  if (opts.reactivate && !after.active) {
    await client.post<Workflow>(`/workflows/${encodeURIComponent(id)}/activate`);
    factory.io.stdout.write(`${c.green('✓')} reactivated ${id}\n`);
  }
}

export function createRollbackCommand(): Command {
  return new Command('rollback')
    .description(
      'Restore a workflow from its newest backup (or --to <file>) with a safety ' +
        'snapshot, diff preview, and confirm gate. Order: snapshot → select target ' +
        '(snapshot excluded) → diff → confirm → restore → verify → optional --reactivate.',
    )
    .argument('<id>', 'workflow ID')
    .option('--to <file>', 'Roll back to this exact backup file (default: newest matching backup)')
    .option('--backup-dir <dir>', 'Backup directory to search (default: ./_backups)')
    .option('--reactivate', 'Activate the workflow after restore')
    .option('-y, --yes', 'Skip the confirmation prompt (required in non-TTY mode)')
    .action(withAction<RollbackOpts>(rollbackHandler));
}
