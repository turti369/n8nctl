import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';
import type { WorkflowTag } from '../../types/n8n.js';

export async function updateTagHandler(
  factory: Factory,
  _opts: unknown,
  args: string[],
): Promise<void> {
  const [id, name] = args;
  const client = await factory.client();

  if (factory.flags.dryRun) {
    factory.io.stdout.write(`${c.yellow('[dry-run]')} would rename tag ${c.bold(id)} → "${name}"\n`);
    return;
  }

  const updated = await client.put<WorkflowTag>(`/tags/${encodeURIComponent(id)}`, { name });
  factory.io.stdout.write(`${c.green('✓')} renamed tag ${c.bold(id)} → "${updated.name}"\n`);
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Rename a tag')
    .argument('<id>', 'tag ID')
    .argument('<name>', 'new tag name')
    .action(withAction(updateTagHandler));
}
