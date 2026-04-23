import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update an existing workflow from a JSON file')
    .argument('<id>', 'workflow ID')
    .argument('<file>', 'path to workflow JSON file')
    .action(
      withAction(async (factory, _opts, args) => {
        const [id, file] = args;
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
        const updated = await client.put<Workflow>(`/workflows/${encodeURIComponent(id)}`, body);

        factory.io.stderr.write(
          `${c.green('✓')} updated workflow ${c.bold(updated.id)} "${updated.name}"\n`,
        );
        await printData(updated, { io: factory.io, opts: factory.flags });
      }),
    );
}
