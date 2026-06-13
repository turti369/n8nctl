import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { rethrowWithLicenseHint } from '../../lib/license.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface PullOpts {
  force?: boolean;
  yes?: boolean;
  backupDir?: string;
  skipBackup?: boolean;
}

/**
 * Guardrails (plan dt-r1-05 — widest blast radius in the CLI: a pull can
 * overwrite MANY workflows at once):
 *   1. MANDATORY pre-pull snapshot of every workflow (export-all bundle) —
 *      refused only with an explicit --skip-backup.
 *   2. Confirm gate: non-TTY requires --yes; --force gets a louder prompt.
 *   3. The n8n import result (created/updated per resource) is printed so the
 *      blast radius is visible after the fact.
 */
export async function sourceControlPullHandler(
  factory: Factory,
  opts: PullOpts,
  _args: string[],
): Promise<void> {
  const client = await factory.client();

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would snapshot all workflows then POST /source-control/pull${opts.force ? ' {force:true}' : ''}\n`,
    );
    return;
  }

  // 1. Pre-pull snapshot bundle.
  let bundleDir: string | null = null;
  if (!opts.skipBackup) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    bundleDir = path.resolve(opts.backupDir ?? '_backups', `pre-pull-${ts}`);
    await fs.mkdir(bundleDir, { recursive: true });
    let count = 0;
    for await (const summary of client.paginate<Workflow>('/workflows', {})) {
      const full = await client.get<Workflow>(`/workflows/${encodeURIComponent(summary.id)}`);
      const slug = full.name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
      await fs.writeFile(
        path.join(bundleDir, `${slug}_${full.id}.json`),
        JSON.stringify(full, null, 2),
        'utf8',
      );
      count++;
    }
    factory.io.stderr.write(`${c.dim('→')} pre-pull snapshot: ${count} workflow(s) → ${bundleDir}\n`);
  } else {
    factory.io.stderr.write(
      `${c.yellow('warning')}: --skip-backup — a bad pull cannot be rolled back from a local bundle\n`,
    );
  }

  // 2. Confirm gate.
  if (!opts.yes) {
    if (!factory.io.isTTY) {
      throw new ValidationError(
        'source-control pull requires confirmation — pass --yes in non-interactive mode',
        'A pull can overwrite many workflows at once. The pre-pull bundle is your rollback point.',
      );
    }
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: opts.force
          ? 'FORCE pull from the connected git branch? Local instance changes will be OVERWRITTEN.'
          : 'Pull from the connected git branch? Instance state may change across many workflows.',
        default: false,
      },
    ]);
    if (!confirm) {
      factory.io.stderr.write(`${c.yellow('cancelled')}${bundleDir ? ` — bundle kept at ${bundleDir}` : ''}\n`);
      return;
    }
  }

  // 3. Pull + report the import result.
  let result: unknown;
  try {
    result = await client.post('/source-control/pull', { force: opts.force === true });
  } catch (err) {
    rethrowWithLicenseHint(err, 'Source Control');
  }

  factory.io.event(
    'source-control-pulled',
    { force: opts.force === true, bundleDir },
    `${c.green('✓')} pulled from source control${opts.force ? ' (force)' : ''}`,
  );
  await printData(result ?? { ok: true }, { io: factory.io, opts: factory.flags });
  if (bundleDir) {
    factory.io.stderr.write(`${c.dim('rollback point:')} ${bundleDir} (n8nctl workflow import <dir> --force)\n`);
  }
}

export function createSourceControlCommand(): Command {
  const cmd = new Command('source-control')
    .alias('sc')
    .description('Source control operations (licensed n8n feature)');
  cmd.addCommand(
    new Command('pull')
      .description(
        'Pull workflows/credentials/variables from the connected git branch. ' +
          'Takes a MANDATORY pre-pull snapshot bundle of all workflows first (rollback point).',
      )
      .option('--force', 'Overwrite local instance changes (louder confirm)')
      .option('-y, --yes', 'Skip the confirmation prompt (required in non-TTY mode)')
      .option('--backup-dir <dir>', 'Where to write the pre-pull bundle (default: ./_backups)')
      .option('--skip-backup', 'DANGEROUS: skip the pre-pull snapshot bundle')
      .action(withAction<PullOpts>(sourceControlPullHandler)),
  );
  return cmd;
}
