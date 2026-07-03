import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { readJsonSource } from '../../lib/stdin.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import { normalizeWorkflow } from '../../lib/normalize.js';
import { autoValidate, type AutoValidateOpts } from '../../lib/auto-validate.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface CreateOpts extends AutoValidateOpts {
  activate?: boolean;
  /** Commander maps `--no-normalize` → { normalize: false }. Default true. */
  normalize?: boolean;
}

export async function createWorkflowHandler(
  factory: Factory,
  opts: CreateOpts,
  args: string[],
): Promise<void> {
  const [file] = args;
  const { raw, source } = await readJsonSource(file);

  let parsed: Partial<Workflow>;
  try {
    parsed = JSON.parse(raw) as Partial<Workflow>;
  } catch (err) {
    throw new ValidationError(`Invalid JSON in ${source}: ${(err as Error).message}`);
  }

  // Auto-normalize to n8n conventions (UUID node ids, save-log settings)
  // unless --no-normalize. Behaviour-preserving (connections key on name).
  if (opts.normalize !== false) {
    const { workflow, changes } = normalizeWorkflow(parsed as Workflow);
    parsed = workflow;
    for (const ch of changes) {
      factory.io.event('workflow-normalized', { change: ch }, `${c.dim('→ normalized:')} ${ch}`);
    }
  }

  // Validate before deploy. Warn-only by default; --validate-policy blocks.
  autoValidate(factory, parsed, opts);

  const body = stripReadOnlyFields(parsed);

  if (factory.flags.dryRun) {
    const nodeCount = Array.isArray(body.nodes) ? body.nodes.length : 0;
    const name = body.name ?? '(unnamed)';
    const suffix = opts.activate ? ' + activate' : '';
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would create workflow "${name}" (${nodeCount} nodes) from ${source}${suffix}\n`,
    );
    return;
  }

  const client = await factory.client();
  const created = await client.post<Workflow>('/workflows', body);

  factory.io.stderr.write(
    `${c.green('✓')} created workflow ${c.bold(created.id)} "${created.name}"\n`,
  );

  if (opts.activate && !created.active) {
    await client.post<Workflow>(`/workflows/${encodeURIComponent(created.id)}/activate`);
    factory.io.stderr.write(`${c.green('✓')} activated ${created.id}\n`);
  }

  await printData(created, { io: factory.io, opts: factory.flags });
}

export function createCreateCommand(): Command {
  return new Command('create')
    .description('Create a workflow from a JSON file (use "-" for stdin)')
    .argument('<file>', 'path to workflow JSON file, or "-" to read stdin')
    .option('--activate', 'Activate the workflow immediately after create (registers webhooks)')
    .option('--no-normalize', 'Skip auto-normalize (UUID node ids + execution-log settings)')
    .option('--no-validate', 'Skip pre-deploy workflow validation')
    .option('--validate-policy <p>', 'Block on validation issues per policy (dev|ci|strict). Default: warn only.')
    .action(withAction<CreateOpts>(createWorkflowHandler));
}
