import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import type { Factory } from '../../factory.js';
import type { Execution } from '../../types/n8n.js';

interface GetOpts {
  logs?: boolean;
}

export async function getExecutionHandler(
  factory: Factory,
  opts: GetOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();
  const params = opts.logs ? { includeData: true } : undefined;
  const execution = await client.get<Execution>(
    `/executions/${encodeURIComponent(id)}`,
    params,
  );
  await printData(execution, { io: factory.io, opts: factory.flags });
}

export function createGetCommand(): Command {
  return new Command('get')
    .description('Get execution details by ID')
    .argument('<id>', 'execution ID')
    .option('--logs', 'Include full execution data (logs / node outputs)')
    .action(withAction<GetOpts>(getExecutionHandler));
}
