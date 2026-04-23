import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

interface GetOpts {
  output?: string;
}

export function createGetCommand(): Command {
  return new Command('get')
    .description('Fetch a workflow by ID')
    .argument('<id>', 'workflow ID')
    .option('-o, --output <file>', 'Write JSON to file instead of stdout')
    .action(
      withAction<GetOpts>(async (factory, opts, args) => {
        const [id] = args;
        const client = await factory.client();
        const workflow = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);

        if (opts.output) {
          await fs.writeFile(opts.output, JSON.stringify(workflow, null, 2), 'utf8');
          factory.io.stderr.write(`${c.green('✓')} saved workflow ${workflow.id} to ${opts.output}\n`);
          return;
        }

        await printData(workflow, { io: factory.io, opts: factory.flags });
      }),
    );
}
