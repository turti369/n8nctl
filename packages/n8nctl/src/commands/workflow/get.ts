import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { redactWorkflow } from '../../lib/redact.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface GetOpts {
  output?: string;
  redact?: boolean;
}

export async function getWorkflowHandler(
  factory: Factory,
  opts: GetOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();
  const raw = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);
  const workflow = opts.redact ? redactWorkflow(raw) : raw;

  if (opts.output) {
    await fs.writeFile(opts.output, JSON.stringify(workflow, null, 2), 'utf8');
    factory.io.stderr.write(
      `${c.green('✓')} saved workflow ${raw.id} to ${opts.output}${opts.redact ? ' (redacted)' : ''}\n`,
    );
    return;
  }

  await printData(workflow, { io: factory.io, opts: factory.flags });
}

export function createGetCommand(): Command {
  return new Command('get')
    .description('Fetch a workflow by ID')
    .argument('<id>', 'workflow ID')
    .option('-o, --output <file>', 'Write JSON to file instead of stdout')
    .option('--redact', 'Scrub pinData, credential names, and webhook IDs before output')
    .action(withAction<GetOpts>(getWorkflowHandler));
}
