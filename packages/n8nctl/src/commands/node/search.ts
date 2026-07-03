import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { nodeListHandler, type NodeListOpts } from './list.js';
import type { Factory } from '../../factory.js';

/** `node search <text>` is sugar for `node list --search <text>`. */
export async function nodeSearchHandler(
  factory: Factory,
  opts: { refresh?: boolean; community?: boolean },
  args: string[],
): Promise<void> {
  const [text] = args;
  const listOpts: NodeListOpts = { search: text, community: opts.community, refresh: opts.refresh };
  await nodeListHandler(factory, listOpts, []);
}

export function createNodeSearchCommand(): Command {
  return new Command('search')
    .description('Search node types by name/displayName (sugar for `node list --search`)')
    .argument('<text>', 'substring to match against type/displayName')
    .option('--community', 'Only community/langchain nodes')
    .option('--refresh', 'Force refetch the catalog (bypass the 24h cache)')
    .action(withAction<{ refresh?: boolean; community?: boolean }>(nodeSearchHandler));
}
