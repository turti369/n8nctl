import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { WorkflowTag } from '../../types/n8n.js';

export function createCreateCommand(): Command {
  return new Command('create')
    .description('Create a new tag')
    .argument('<name>', 'tag name')
    .action(
      withAction(async (factory, _opts, args) => {
        const [name] = args;
        const client = await factory.client();
        if (factory.flags.dryRun) {
          factory.io.stdout.write(`${c.yellow('[dry-run]')} would create tag "${name}"\n`);
          return;
        }
        const created = await client.post<WorkflowTag>('/tags', { name });
        factory.io.stdout.write(
          `${c.green('✓')} created tag ${c.bold(created.id)} "${created.name}"\n`,
        );
      }),
    );
}
