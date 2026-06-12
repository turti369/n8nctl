import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

export async function retryHandler(
  factory: Factory,
  _opts: unknown,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();
  const result = await client.post<{ id: string }>(
    `/executions/${encodeURIComponent(id)}/retry`,
  );
  factory.io.stdout.write(
    `${c.green('✓')} retry triggered — new execution: ${c.bold(result.id ?? 'unknown')}\n`,
  );
}

export function createRetryCommand(): Command {
  return new Command('retry')
    .description('Retry a failed execution')
    .argument('<id>', 'execution ID')
    .action(withAction(retryHandler));
}
