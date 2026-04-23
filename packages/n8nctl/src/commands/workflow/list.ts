import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { redactWorkflow } from '../../lib/redact.js';
import type { Workflow, PaginatedResponse } from '../../types/n8n.js';

interface ListOpts {
  active?: boolean;
  tag?: string;
  limit?: string;
  all?: boolean;
  search?: string;
  redact?: boolean;
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List workflows on the active n8n instance')
    .option('--active', 'Show only active workflows')
    .option('--tag <tag>', 'Filter by tag name')
    .option('--search <text>', 'Case-insensitive substring match on workflow name')
    .option('--limit <n>', 'Maximum results (default 100). Ignored with --all.')
    .option('--all', 'Fetch ALL workflows across pages (auto-paginate)')
    .option('--redact', 'Scrub pinData, credential names, and webhook IDs from each workflow')
    .action(
      withAction<ListOpts>(async (factory, opts) => {
        const client = await factory.client();
        const baseParams: Record<string, unknown> = {};
        if (opts.active !== undefined) baseParams.active = opts.active;
        if (opts.tag) baseParams.tags = opts.tag;

        let workflows: Workflow[];
        if (opts.all) {
          workflows = [];
          for await (const wf of client.paginate<Workflow>('/workflows', baseParams)) {
            workflows.push(wf);
          }
        } else {
          const resp = await client.get<PaginatedResponse<Workflow>>('/workflows', {
            ...baseParams,
            limit: opts.limit ? Number(opts.limit) : 100,
          });
          workflows = resp.data;
          if (resp.nextCursor && factory.io.isTTY) {
            factory.io.stderr.write(
              '\x1b[33mnote\x1b[0m: more workflows exist — use --all to fetch everything\n',
            );
          }
        }

        if (opts.search) {
          const needle = opts.search.toLowerCase();
          workflows = workflows.filter((w) => w.name.toLowerCase().includes(needle));
        }

        const output = opts.redact ? workflows.map((w) => redactWorkflow(w)) : workflows;

        await printData(output, { io: factory.io, opts: factory.flags }, (d) => {
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
