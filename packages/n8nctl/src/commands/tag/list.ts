import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { parsePositiveInt } from '../../lib/util.js';
import type { Factory } from '../../factory.js';
import type { WorkflowTag } from '../../types/n8n.js';

interface ListOpts {
  limit?: string;
  all?: boolean;
}

export async function listTagsHandler(
  factory: Factory,
  opts: ListOpts,
  _args: string[],
): Promise<void> {
  const client = await factory.client();
  let tags: WorkflowTag[];
  if (opts.all) {
    tags = [];
    for await (const t of client.paginate<WorkflowTag>('/tags', {})) {
      tags.push(t);
    }
  } else {
    const resp = await client.get<{ data: WorkflowTag[] }>('/tags', {
      limit: parsePositiveInt(opts.limit, '--limit', 100),
    });
    tags = resp.data;
  }

  await printData(tags, { io: factory.io, opts: factory.flags }, (d) => {
    const rows = (d as WorkflowTag[]).map((t) => [t.id, t.name]);
    return { head: ['ID', 'NAME'], rows };
  });
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List tags on the active instance')
    .option('--limit <n>', 'Max results (default 100)')
    .option('--all', 'Fetch all via pagination')
    .action(withAction<ListOpts>(listTagsHandler));
}
