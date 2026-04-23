import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import type { Workflow, PaginatedResponse } from '../../types/n8n.js';

interface ListOpts {
  active?: boolean;
  tag?: string;
  limit?: string;
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List workflows on the active n8n instance')
    .option('--active', 'Show only active workflows')
    .option('--tag <tag>', 'Filter by tag name')
    .option('--limit <n>', 'Maximum results (default 100)')
    .action(
      withAction<ListOpts>(async (factory, opts) => {
        const client = await factory.client();
        const params: Record<string, unknown> = {
          limit: opts.limit ? Number(opts.limit) : 100,
        };
        if (opts.active !== undefined) params.active = opts.active;
        if (opts.tag) params.tags = opts.tag;

        const resp = await client.get<PaginatedResponse<Workflow>>('/workflows', params);

        await printData(resp.data, { io: factory.io, opts: factory.flags }, (d) => {
          const rows = (d as Workflow[]).map((w) => [
            String(w.id),
            w.name,
            w.active ? 'yes' : 'no',
            w.tags?.map((t) => t.name).join(', ') ?? '',
            w.updatedAt?.slice(0, 19).replace('T', ' ') ?? '',
          ]);
          return { head: ['ID', 'NAME', 'ACTIVE', 'TAGS', 'UPDATED'], rows };
        });
      }),
    );
}
