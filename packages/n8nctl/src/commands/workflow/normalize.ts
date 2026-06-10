import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { readJsonSource } from '../../lib/stdin.js';
import { normalizeWorkflow } from '../../lib/normalize.js';
import type { Workflow } from '../../types/n8n.js';

interface NormalizeOpts {
  output?: string;
  write?: boolean;
}

export function createNormalizeCommand(): Command {
  return new Command('normalize')
    .description(
      'Normalize a workflow JSON to n8n conventions (UUID node ids + execution-log ' +
        'settings) without changing behaviour. Use before validate/deploy, or to clean ' +
        'a Claude-generated file. Does NOT bump typeVersion (validator E072 warns instead).',
    )
    .argument('<file>', 'path to workflow JSON file, or "-" for stdin')
    .option('-o, --output <path>', 'write normalized JSON to this path (default: stdout)')
    .option('-w, --write', 'write back in place (overwrites <file>)')
    .action(
      withAction<NormalizeOpts>(async (factory, opts, args) => {
        const [file] = args;
        const { raw, source } = await readJsonSource(file);

        let parsed: Workflow;
        try {
          parsed = JSON.parse(raw) as Workflow;
        } catch (err) {
          throw new ValidationError(`Invalid JSON in ${source}: ${(err as Error).message}`);
        }

        const { workflow, changes } = normalizeWorkflow(parsed);

        for (const ch of changes) {
          factory.io.event('workflow-normalized', { change: ch }, `${c.dim('→')} ${ch}`);
        }
        if (changes.length === 0) {
          factory.io.stderr.write(`${c.green('✓')} already normalized — no changes\n`);
        }

        if (factory.flags.dryRun) {
          factory.io.stdout.write(`${c.yellow('[dry-run]')} ${changes.length} change(s); not written\n`);
          return;
        }

        const json = JSON.stringify(workflow, null, 2) + '\n';
        const outPath = opts.write ? (source !== '<stdin>' ? source : undefined) : opts.output;
        if (outPath) {
          await fs.writeFile(path.resolve(outPath), json, 'utf8');
          factory.io.stderr.write(`${c.green('✓')} wrote normalized workflow → ${outPath}\n`);
        } else {
          factory.io.stdout.write(json);
        }
      }),
    );
}
