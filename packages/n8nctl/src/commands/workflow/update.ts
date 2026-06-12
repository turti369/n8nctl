import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { readJsonSource } from '../../lib/stdin.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import { normalizeWorkflow } from '../../lib/normalize.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface UpdateOpts {
  activate?: boolean;
  /** Commander maps `--no-normalize` → { normalize: false }. Default true. */
  normalize?: boolean;
}

export async function updateWorkflowHandler(
  factory: Factory,
  opts: UpdateOpts,
  args: string[],
): Promise<void> {
  const [id, file] = args;
  const { raw, source } = await readJsonSource(file);

  let parsed: Partial<Workflow>;
  try {
    parsed = JSON.parse(raw) as Partial<Workflow>;
  } catch (err) {
    throw new ValidationError(`Invalid JSON in ${source}: ${(err as Error).message}`);
  }

  // Auto-normalize unless --no-normalize. Deterministic UUIDs (from node
  // name) keep ids stable across repeated updates — no churn.
  if (opts.normalize !== false) {
    const { workflow, changes } = normalizeWorkflow(parsed as Workflow);
    parsed = workflow;
    for (const ch of changes) {
      factory.io.event('workflow-normalized', { change: ch }, `${c.dim('→ normalized:')} ${ch}`);
    }
  }

  const body = stripReadOnlyFields(parsed);

  if (factory.flags.dryRun) {
    const nodeCount = Array.isArray(body.nodes) ? body.nodes.length : 0;
    const name = body.name ?? '(unnamed)';
    const suffix = opts.activate ? ' + activate' : '';
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would update workflow ${c.bold(id)} with "${name}" (${nodeCount} nodes) from ${source}${suffix}\n`,
    );
    return;
  }

  const client = await factory.client();
  const updated = await client.put<Workflow>(`/workflows/${encodeURIComponent(id)}`, body);

  factory.io.stderr.write(
    `${c.green('✓')} updated workflow ${c.bold(updated.id)} "${updated.name}"\n`,
  );

  if (opts.activate && !updated.active) {
    await client.post<Workflow>(`/workflows/${encodeURIComponent(updated.id)}/activate`);
    factory.io.stderr.write(`${c.green('✓')} activated ${updated.id}\n`);
  }

  await printData(updated, { io: factory.io, opts: factory.flags });
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update an existing workflow from a JSON file (use "-" for stdin)')
    .argument('<id>', 'workflow ID')
    .argument('<file>', 'path to workflow JSON file, or "-" to read stdin')
    .option('--activate', 'Activate the workflow after update (registers webhooks)')
    .option('--no-normalize', 'Skip auto-normalize (UUID node ids + execution-log settings)')
    .action(withAction<UpdateOpts>(updateWorkflowHandler));
}
