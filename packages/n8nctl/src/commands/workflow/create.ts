import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { readJsonSource } from '../../lib/stdin.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import type { Workflow } from '../../types/n8n.js';

export function createCreateCommand(): Command {
  return new Command('create')
    .description('Create a workflow from a JSON file (use "-" for stdin)')
    .argument('<file>', 'path to workflow JSON file, or "-" to read stdin')
    .action(
      withAction(async (factory, _opts, args) => {
        const [file] = args;
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
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would create workflow "${name}" (${nodeCount} nodes) from ${source}\n`,
          );
          return;
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
