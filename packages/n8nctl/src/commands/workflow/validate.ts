import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validate as runValidate } from '@trngthnh369/n8n-workflow-validator';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

interface ValidateOpts {
  strict?: boolean;
}

export async function validateHandler(
  factory: Factory,
  opts: ValidateOpts,
  args: string[],
): Promise<void> {
  const [file] = args;
  const absPath = path.resolve(file);
  const raw = await fs.readFile(absPath, 'utf8').catch((e) => {
    throw new ValidationError(`Cannot read ${absPath}: ${(e as Error).message}`);
  });

  let wf: unknown;
  try {
    wf = JSON.parse(raw);
  } catch (e) {
    throw new ValidationError(`Invalid JSON: ${(e as Error).message}`);
  }

  const result = runValidate(wf, { strict: opts.strict });

  if (result.valid && result.issues.length === 0) {
    factory.io.stdout.write(
      `${c.green('✓')} ${path.basename(absPath)} passed validation (${result.nodeCount} nodes)\n`,
    );
    return;
  }

  if (result.issues.length > 0) {
    factory.io.stderr.write(`\n${c.red('✗ VALIDATION')}\n\n`);
    result.issues.forEach((e, i) => {
      const color =
        e.severity === 'CRITICAL' ? c.red : e.severity === 'HIGH' ? c.yellow : c.dim;
      factory.io.stderr.write(
        `  ${i + 1}. ${color(`[${e.severity}]`)} ${e.code}: ${e.msg}\n`,
      );
    });
    factory.io.stderr.write(`\nTotal: ${result.issues.length} issue(s)\n`);
  }

  if (!result.valid) {
    throw new ValidationError(`Validation failed`);
  }
}

export function createValidateCommand(): Command {
  return new Command('validate')
    .description('Validate a workflow JSON file locally (6-layer check)')
    .argument('<file>', 'path to workflow JSON file')
    .option('--strict', 'Fail on MEDIUM-severity issues too')
    .action(withAction<ValidateOpts>(validateHandler));
}
