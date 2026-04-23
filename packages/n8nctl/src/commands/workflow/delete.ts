import { Command } from 'commander';
import inquirer from 'inquirer';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

interface DeleteOpts {
  yes?: boolean;
}

export function createDeleteCommand(): Command {
  return new Command('delete')
    .alias('rm')
    .description('Delete a workflow')
    .argument('<id>', 'workflow ID')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(
      withAction<DeleteOpts>(async (factory, opts, args) => {
        const [id] = args;
        const client = await factory.client();

        if (factory.flags.dryRun) {
          const wf = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would delete workflow ${c.bold(wf.id)} "${wf.name}" (active=${wf.active})\n`,
          );
          return;
        }

        if (!opts.yes && factory.io.isTTY) {
          const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete workflow ${id}? This cannot be undone.`,
              default: false,
            },
          ]);
          if (!confirm) {
            factory.io.stderr.write(`${c.yellow('cancelled')}\n`);
            return;
          }
        }

        await client.delete(`/workflows/${encodeURIComponent(id)}`);
        factory.io.stdout.write(`${c.red('✗')} deleted workflow ${c.bold(id)}\n`);
      }),
    );
}
