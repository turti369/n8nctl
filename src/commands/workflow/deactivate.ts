import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

export function createDeactivateCommand(): Command {
  return new Command('deactivate')
    .description('Deactivate a workflow')
    .argument('<id>', 'workflow ID')
    .action(
      withAction(async (factory, _opts, args) => {
        const [id] = args;
        const client = await factory.client();
        const result = await client.post<Workflow>(`/workflows/${encodeURIComponent(id)}/deactivate`);
        factory.io.stdout.write(
          `${c.yellow('○')} deactivated workflow ${c.bold(result.id)} "${result.name}"\n`,
        );
      }),
    );
}
