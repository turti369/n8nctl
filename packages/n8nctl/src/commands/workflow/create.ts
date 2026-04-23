import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

export function createCreateCommand(): Command {
  return new Command('create')
    .description('Create a workflow from a JSON file')
    .argument('<file>', 'path to workflow JSON file')
    .action(
      withAction(async (factory, _opts, args) => {
        const [file] = args;
        const absPath = path.resolve(file);
        let raw: string;
        try {
          raw = await fs.readFile(absPath, 'utf8');
        } catch (err) {
          throw new ValidationError(`Cannot read ${absPath}: ${(err as Error).message}`);
        }

        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch (err) {
          throw new ValidationError(`Invalid JSON in ${absPath}: ${(err as Error).message}`);
        }

        const client = await factory.client();
        const created = await client.post<Workflow>('/workflows', body);

        factory.io.stderr.write(
          `${c.green('✓')} created workflow ${c.bold(created.id)} "${created.name}"\n`,
        );
        await printData(created, { io: factory.io, opts: factory.flags });
      }),
    );
}
