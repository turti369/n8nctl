import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { getLastError } from '../../lib/execution.js';
import { c } from '../../lib/io.js';

interface LastErrorOpts {
  workflow: string;
  summary?: boolean;
}

export function createLastErrorCommand(): Command {
  return new Command('last-error')
    .description('Fetch the most recent failed execution for a workflow')
    .requiredOption('--workflow <id>', 'workflow ID')
    .option('--summary', 'Print short summary instead of full execution JSON')
    .action(
      withAction<LastErrorOpts>(async (factory, opts) => {
        const client = await factory.client();
        const exec = await getLastError(client, opts.workflow);

        if (!exec) {
          factory.io.stdout.write(
            `${c.green('✓')} no failed executions found for workflow ${opts.workflow}\n`,
          );
          return;
        }

        if (opts.summary) {
          const errorNode = extractErrorNode(exec);
          factory.io.stdout.write(
            `${c.red('✗')} execution ${c.bold(exec.id)} failed at ${exec.stoppedAt ?? '?'}\n`,
          );
          if (errorNode) {
            factory.io.stdout.write(`  node: ${errorNode.node}\n  error: ${errorNode.message}\n`);
          }
          return;
        }

        await printData(exec, { io: factory.io, opts: factory.flags });
      }),
    );
}

function extractErrorNode(exec: { data?: unknown }): { node: string; message: string } | null {
  const data = exec.data as
    | { resultData?: { error?: { node?: { name?: string }; message?: string } } }
    | undefined;
  const err = data?.resultData?.error;
  if (!err) return null;
  return {
    node: err.node?.name ?? 'unknown',
    message: err.message ?? 'no message',
  };
}
