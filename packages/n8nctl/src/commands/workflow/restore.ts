import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface RestoreOpts {
  id?: string;
  activate?: boolean;
}

export async function restoreHandler(
  factory: Factory,
  opts: RestoreOpts,
  args: string[],
): Promise<void> {
  const [file] = args;
  const absPath = path.resolve(file);
  let workflow: Workflow;
  try {
    workflow = JSON.parse(await fs.readFile(absPath, 'utf8')) as Workflow;
  } catch (err) {
    throw new ValidationError(`Cannot parse ${absPath}: ${(err as Error).message}`);
  }

  const targetId = opts.id ?? workflow.id;
  if (!targetId) {
    throw new ValidationError(
      'Backup file has no "id" field and --id was not provided',
      'Use --id <workflow-id> to target a specific workflow.',
    );
  }

  const client = await factory.client();

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would restore ${c.bold(targetId)} from ${absPath} (${workflow.nodes?.length ?? 0} nodes)${opts.activate ? ' + activate' : ''}\n`,
    );
    return;
  }

  const body = stripReadOnlyFields(workflow);
  const restored = await client.put<Workflow>(
    `/workflows/${encodeURIComponent(targetId)}`,
    body,
  );
  factory.io.stdout.write(
    `${c.green('✓')} restored workflow ${c.bold(restored.id)} "${restored.name}"\n`,
  );

  if (opts.activate && !restored.active) {
    await client.post<Workflow>(`/workflows/${encodeURIComponent(restored.id)}/activate`);
    factory.io.stdout.write(`${c.green('✓')} activated ${restored.id}\n`);
  }
}

export function createRestoreCommand(): Command {
  return new Command('restore')
    .description('Restore a workflow from a backup JSON file (update or create)')
    .argument('<file>', 'backup JSON file')
    .option('--id <id>', 'Target workflow ID (default: use id from file)')
    .option('--activate', 'Activate after restore')
    .action(withAction<RestoreOpts>(restoreHandler));
}
