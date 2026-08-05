import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { confirmPrompt } from '../../lib/prompt.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

interface CredDeleteOpts {
  yes?: boolean;
}

export async function deleteCredentialHandler(
  factory: Factory,
  opts: CredDeleteOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();

  if (factory.flags.dryRun) {
    factory.io.stdout.write(`${c.yellow('[dry-run]')} would delete credential ${c.bold(id)}\n`);
    return;
  }

  if (!opts.yes && factory.io.isTTY) {
    if (
      !(await confirmPrompt(
        `Delete credential ${id}? Workflows referencing it will fail at runtime. This cannot be undone.`,
      ))
    ) {
      factory.io.stderr.write(`${c.yellow('cancelled')}\n`);
      return;
    }
  }

  await client.delete(`/credentials/${encodeURIComponent(id)}`);
  factory.io.stdout.write(`${c.green('✓')} deleted credential ${c.bold(id)}\n`);
}

export function createDeleteCommand(): Command {
  return new Command('delete')
    .alias('rm')
    .description('Delete a credential')
    .argument('<id>', 'credential ID')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(withAction<CredDeleteOpts>(deleteCredentialHandler));
}
