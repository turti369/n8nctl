import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { loadNodeCatalog, filterNodes, versionsLabel, isCommunityNode } from '../../lib/node-catalog.js';
import type { Factory } from '../../factory.js';

export interface NodeListOpts {
  search?: string;
  community?: boolean;
  refresh?: boolean;
}

export async function nodeListHandler(
  factory: Factory,
  opts: NodeListOpts,
  _args: string[],
): Promise<void> {
  const session = await factory.sessionClient();
  const all = await loadNodeCatalog(session, { refresh: opts.refresh });
  const nodes = filterNodes(all, { search: opts.search, community: opts.community });

  // Lean projection so --json stays compact (the raw entries carry full
  // property schemas — use `node describe <type>` for those).
  const lean = nodes.map((n) => ({
    type: n.name,
    name: n.displayName ?? '',
    versions: versionsLabel(n),
    pkg: isCommunityNode(n) ? 'community' : 'base',
  }));

  await printData(lean, { io: factory.io, opts: factory.flags }, (d) => {
    const rows = (d as typeof lean).map((n) => [n.type, n.name, n.versions, n.pkg]);
    return { head: ['TYPE', 'NAME', 'VERSIONS', 'PKG'], rows };
  });
}

export function createNodeListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List node types available on THIS instance (live catalog, incl. community nodes)')
    .option('--search <text>', 'Filter by name/displayName substring')
    .option('--community', 'Only community/langchain nodes (non n8n-nodes-base)')
    .option('--refresh', 'Force refetch the catalog (bypass the 24h cache)')
    .action(withAction<NodeListOpts>(nodeListHandler));
}
