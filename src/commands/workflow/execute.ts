import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';

interface ExecOpts {
  data?: string;
  file?: string;
}

export function createExecuteCommand(): Command {
  return new Command('execute')
    .alias('run')
    .description('Trigger a workflow execution')
    .argument('<id>', 'workflow ID')
    .option('--data <json>', 'Inline JSON payload')
    .option('--file <path>', 'Read payload from JSON file')
    .action(
      withAction<ExecOpts>(async (factory, opts, args) => {
        const [id] = args;

        let body: unknown = {};
        if (opts.file) {
          const raw = await fs.readFile(opts.file, 'utf8');
          try {
            body = JSON.parse(raw);
          } catch (err) {
            throw new ValidationError(`Invalid JSON in ${opts.file}: ${(err as Error).message}`);
          }
        } else if (opts.data) {
          try {
            body = JSON.parse(opts.data);
          } catch (err) {
            throw new ValidationError(`Invalid --data JSON: ${(err as Error).message}`);
          }
        }

        const client = await factory.client();
        const spinner = factory.io.spinner(`Executing workflow ${id}...`).start();
        try {
          const result = await client.post<unknown>(
            `/workflows/${encodeURIComponent(id)}/execute`,
            body,
          );
          spinner.succeed(`Execution triggered for workflow ${id}`);
          await printData(result, { io: factory.io, opts: factory.flags });
        } catch (err) {
          spinner.fail(`${c.red('Execution failed')}`);
          throw err;
        }
      }),
    );
}
