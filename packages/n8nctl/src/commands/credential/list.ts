import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import type { Workflow } from '../../types/n8n.js';

interface ListOpts {
  type?: string;
}

interface CredentialRef {
  id: string;
  name: string;
  type: string;
  usedInWorkflows: string[];
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description(
      'List credentials discovered across all workflows ' +
        '(n8n Public API does not have a GET /credentials endpoint; we derive from nodes).',
    )
    .option('--type <type>', 'Filter by credential type (e.g. "httpHeaderAuth")')
    .action(
      withAction<ListOpts>(async (factory, opts) => {
        const client = await factory.client();

        const creds = new Map<string, CredentialRef>();
        for await (const wf of client.paginate<Workflow>('/workflows', {})) {
          for (const node of wf.nodes ?? []) {
            const credsOnNode = (node as { credentials?: Record<string, { id?: string; name?: string }> })
              .credentials;
            if (!credsOnNode) continue;
            for (const [type, ref] of Object.entries(credsOnNode)) {
              if (!ref?.id) continue;
              const key = `${type}::${ref.id}`;
              const existing = creds.get(key);
              if (existing) {
                existing.usedInWorkflows.push(wf.name);
              } else {
                creds.set(key, {
                  id: ref.id,
                  name: ref.name ?? '(unknown)',
                  type,
                  usedInWorkflows: [wf.name],
                });
              }
            }
          }
        }

        let list = [...creds.values()];
        if (opts.type) list = list.filter((c) => c.type === opts.type);

        await printData(list, { io: factory.io, opts: factory.flags }, (d) => {
          const rows = (d as CredentialRef[]).map((c) => [
            c.id,
            c.name,
            c.type,
            String(c.usedInWorkflows.length),
          ]);
          return { head: ['ID', 'NAME', 'TYPE', 'WORKFLOWS'], rows };
        });
      }),
    );
}
