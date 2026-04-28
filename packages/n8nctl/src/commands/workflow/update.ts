import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { readJsonSource } from '../../lib/stdin.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import type { Workflow } from '../../types/n8n.js';

interface UpdateOpts {
  activate?: boolean;
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update an existing workflow from a JSON file (use "-" for stdin)')
    .argument('<id>', 'workflow ID')
    .argument('<file>', 'path to workflow JSON file, or "-" to read stdin')
    .option('--activate', 'Activate the workflow after update (registers webhooks)')
    .action(
      withAction<UpdateOpts>(async (factory, opts, args) => {
        const [id, file] = args;
        const { raw, source } = await readJsonSource(file);

        let parsed: Partial<Workflow>;
        try {
          parsed = JSON.parse(raw) as Partial<Workflow>;
        } catch (err) {
          throw new ValidationError(`Invalid JSON in ${source}: ${(err as Error).message}`);
        }

        const body = stripReadOnlyFields(parsed);

        if (factory.flags.dryRun) {
          const nodeCount = Array.isArray(body.nodes) ? body.nodes.length : 0;
          const name = body.name ?? '(unnamed)';
          const suffix = opts.activate ? ' + activate' : '';
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would update workflow ${c.bold(id)} with "${name}" (${nodeCount} nodes) from ${source}${suffix}\n`,
          );
          return;
        }

        const client = await factory.client();
        const updated = await client.put<Workflow>(`/workflows/${encodeURIComponent(id)}`, body);

        factory.io.stderr.write(
          `${c.green('✓')} updated workflow ${c.bold(updated.id)} "${updated.name}"\n`,
        );

        if (opts.activate && !updated.active) {
          await client.post<Workflow>(`/workflows/${encodeURIComponent(updated.id)}/activate`);
          factory.io.stderr.write(`${c.green('✓')} activated ${updated.id}\n`);
        }

        await printData(updated, { io: factory.io, opts: factory.flags });
      }),
    );
}
