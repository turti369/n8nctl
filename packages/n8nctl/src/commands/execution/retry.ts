import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

interface RetryOpts {
  loadWorkflow?: boolean;
}

export async function retryHandler(
  factory: Factory,
  opts: RetryOpts,
  args: string[],
): Promise<void> {
  const [id] = args;

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would retry execution ${c.bold(id)} via /rest\n`,
    );
    return;
  }

  // The Public API v1 has no execution-retry endpoint — retry lives only on the
  // internal /rest API, so this needs a session login (`n8nctl auth login --session`).
  const session = await factory.sessionClient();
  const result = await session.retryExecution(id, opts.loadWorkflow ?? false);
  const newId = result.id !== undefined && result.id !== null ? String(result.id) : 'unknown';
  factory.io.event(
    'execution-retried',
    { executionId: id, newExecutionId: newId },
    `${c.green('✓')} retry triggered — new execution: ${c.bold(newId)}`,
  );
  await printData(
    { executionId: id, newExecutionId: newId, status: result.status ?? null },
    { io: factory.io, opts: factory.flags },
  );
}

export function createRetryCommand(): Command {
  return new Command('retry')
    .description(
      'Retry a failed execution (uses the internal /rest API — requires ' +
        '`n8nctl auth login --session`)',
    )
    .argument('<id>', 'execution ID')
    .option('--load-workflow', 'Reload the current saved workflow instead of the execution snapshot')
    .action(withAction<RetryOpts>(retryHandler));
}
