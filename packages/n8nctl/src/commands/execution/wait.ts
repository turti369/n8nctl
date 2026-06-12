import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { waitForExecution } from '../../lib/execution.js';
import { c } from '../../lib/io.js';
import { parsePositiveInt } from '../../lib/util.js';
import type { Factory } from '../../factory.js';

interface WaitOpts {
  timeout?: string;
  poll?: string;
}

export async function waitHandler(
  factory: Factory,
  opts: WaitOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();
  const timeout = parsePositiveInt(opts.timeout, '--timeout', 120000);
  const pollInterval = parsePositiveInt(opts.poll, '--poll', 2000);

  const spinner = factory.io.spinner(`Waiting for execution ${id}...`).start();
  try {
    const exec = await waitForExecution(client, {
      executionId: id,
      timeoutMs: timeout,
      pollIntervalMs: pollInterval,
    });
    const status = (exec.status ?? '').toLowerCase();
    if (status === 'success') {
      spinner.succeed(`${c.green(status)}`);
    } else {
      spinner.fail(`${c.red(status || 'finished')}`);
    }
    await printData(exec, { io: factory.io, opts: factory.flags });
    if (status !== 'success' && status !== '') {
      process.exitCode = 1;
    }
  } catch (err) {
    spinner.fail((err as Error).message);
    throw err;
  }
}

export function createWaitCommand(): Command {
  return new Command('wait')
    .description('Poll until an execution reaches a terminal state (success/error/canceled/crashed)')
    .argument('<id>', 'execution ID')
    .option('--timeout <ms>', 'Max wait time in ms (default: 120000)')
    .option('--poll <ms>', 'Polling interval in ms (default: 2000)')
    .action(withAction<WaitOpts>(waitHandler));
}
