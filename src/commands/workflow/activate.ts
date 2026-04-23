import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

export function createActivateCommand(): Command {
  return new Command('activate')
    .description('Activate a workflow')
    .argument('<id>', 'workflow ID')
    .action(
      withAction(async (factory, _opts, args) => {
        const [id] = args;
        const client = await factory.client();
        const result = await client.post<Workflow>(`/workflows/${encodeURIComponent(id)}/activate`);
        factory.io.stdout.write(
          `${c.green('✓')} activated workflow ${c.bold(result.id)} "${result.name}"\n`,
        );
      }),
    );
}
