import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { parsePositiveInt } from '../../lib/util.js';
import type { Factory } from '../../factory.js';
import type { Execution, PaginatedResponse } from '../../types/n8n.js';

interface ListOpts {
  workflow?: string;
  status?: string;
  limit?: string;
}

export async function listExecutionsHandler(
  factory: Factory,
  opts: ListOpts,
  _args: string[],
): Promise<void> {
  const client = await factory.client();
  const params: Record<string, unknown> = {
    limit: parsePositiveInt(opts.limit, '--limit', 20),
  };
  if (opts.workflow) params.workflowId = opts.workflow;
  if (opts.status) params.status = opts.status;

  const resp = await client.get<PaginatedResponse<Execution>>('/executions', params);

  await printData(resp.data, { io: factory.io, opts: factory.flags }, (d) => {
    const rows = (d as Execution[]).map((e) => [
      e.id,
      e.workflowId,
      e.status ?? (e.finished ? 'finished' : 'running'),
      e.startedAt?.slice(0, 19).replace('T', ' ') ?? '',
      e.stoppedAt?.slice(0, 19).replace('T', ' ') ?? '-',
    ]);
    return { head: ['ID', 'WORKFLOW', 'STATUS', 'STARTED', 'STOPPED'], rows };
  });
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List recent executions')
    .option('--workflow <id>', 'Filter by workflow ID')
    .option('--status <status>', 'Filter by status (success|error|waiting|canceled|running)')
    .option('--limit <n>', 'Maximum results (default 20)')
    .action(withAction<ListOpts>(listExecutionsHandler));
}
