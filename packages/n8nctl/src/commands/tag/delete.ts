import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { confirmPrompt } from '../../lib/prompt.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

interface TagDeleteOpts {
  yes?: boolean;
}

export async function deleteTagHandler(
  factory: Factory,
  opts: TagDeleteOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();

  if (factory.flags.dryRun) {
    factory.io.stdout.write(`${c.yellow('[dry-run]')} would delete tag ${c.bold(id)}\n`);
    return;
  }

  if (!opts.yes && factory.io.isTTY) {
    if (!(await confirmPrompt(`Delete tag ${id}? Workflows keep running; only the tag is removed.`))) {
      factory.io.stderr.write(`${c.yellow('cancelled')}\n`);
      return;
    }
  }

  await client.delete(`/tags/${encodeURIComponent(id)}`);
  factory.io.stdout.write(`${c.green('✓')} deleted tag ${c.bold(id)}\n`);
}

export function createDeleteCommand(): Command {
  return new Command('delete')
    .alias('rm')
    .description('Delete a tag')
    .argument('<id>', 'tag ID')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(withAction<TagDeleteOpts>(deleteTagHandler));
}
