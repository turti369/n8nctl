import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { rethrowWithLicenseHint } from '../../lib/license.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

interface WfTransferOpts {
  to?: string;
}

export async function transferWorkflowHandler(
  factory: Factory,
  opts: WfTransferOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  if (!opts.to) {
    throw new ValidationError('--to <projectId> is required', 'Specify the destination project ID.');
  }
  const client = await factory.client();

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would transfer workflow ${c.bold(id)} → project ${opts.to}\n`,
    );
    return;
  }

  try {
    await client.put(`/workflows/${encodeURIComponent(id)}/transfer`, {
      destinationProjectId: opts.to,
    });
  } catch (err) {
    rethrowWithLicenseHint(err, 'Projects (workflow transfer)');
  }
  factory.io.stdout.write(`${c.green('✓')} transferred workflow ${c.bold(id)} → project ${opts.to}\n`);
}

export function createTransferCommand(): Command {
  return new Command('transfer')
    .description('Move a workflow to another project (licensed: Projects)')
    .argument('<id>', 'workflow ID')
    .requiredOption('--to <projectId>', 'destination project ID')
    .action(withAction<WfTransferOpts>(transferWorkflowHandler));
}
