import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validate as runValidate } from '@trngthnh369/n8n-workflow-validator';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { normalizeWorkflow } from '../../lib/normalize.js';
import { readConfigSync } from '../../lib/config.js';
import { resolveSyncedCatalog } from '../../lib/validator-catalog.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface ValidateOpts {
  strict?: boolean;
  /**
   * Named --policy on the CLI: a local `--profile` can never win against the
   * GLOBAL auth `--profile` flag — commander consumes program-level options
   * before dispatching to the subcommand (verified on commander 12.1).
   */
  policy?: string;
  fix?: boolean;
}

const PROFILES = ['dev', 'ci', 'strict'] as const;

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

  // --fix: apply ONLY the mechanical normalize-class fixes (deterministic
  // node ids → E071, execution-log settings → E070) and write back, then
  // validate the fixed document. Semantic issues stay the n8n-fix skill's job.
  if (opts.fix && !factory.flags.dryRun) {
    const { workflow, changes } = normalizeWorkflow(wf as Workflow);
    if (changes.length > 0) {
      await fs.writeFile(absPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
      factory.io.stderr.write(
        `${c.green('✓')} --fix applied ${changes.length} normalize change(s) to ${path.basename(absPath)}\n`,
      );
      wf = workflow;
    } else {
      factory.io.stderr.write(`${c.dim('→')} --fix: nothing mechanically fixable\n`);
    }
  }

  if (opts.policy && !PROFILES.includes(opts.policy as (typeof PROFILES)[number])) {
    throw new ValidationError(
      `Unknown policy "${opts.policy}"`,
      `Pick one of: ${PROFILES.join(', ')}`,
    );
  }

  // Prefer the active profile's synced catalog (from `catalog sync`) so param
  // checks cover this instance's real node set; else the validator's bundled one.
  const profileName = factory.flags.profile ?? readConfigSync().activeProfile ?? 'default';
  const catalog = resolveSyncedCatalog(profileName);

  const result = runValidate(wf, {
    strict: opts.strict,
    profile: opts.policy as 'dev' | 'ci' | 'strict' | undefined,
    ...(catalog ? { catalog } : {}),
  });

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
      const fixable = e.fixable ? c.dim(' (fixable — run: n8nctl workflow normalize)') : '';
      factory.io.stderr.write(
        `  ${i + 1}. ${color(`[${e.severity}]`)} ${e.code}: ${e.msg}${fixable}\n`,
      );
    });
    factory.io.stderr.write(`\nTotal: ${result.issues.length} issue(s)\n`);
    if (result.issues.some((e) => e.fixable)) {
      factory.io.stderr.write(
        `${c.dim('hint:')} fixable issues can be cleared with \`n8nctl workflow normalize <file> -w\`\n`,
      );
    }
  }

  if (!result.valid) {
    throw new ValidationError(`Validation failed`);
  }
}

export function createValidateCommand(): Command {
  return new Command('validate')
    .description('Validate a workflow JSON file locally (6-layer check)')
    .argument('<file>', 'path to workflow JSON file')
    .option('--strict', 'Fail on MEDIUM-severity issues too (alias of --policy strict)')
    .option(
      '--policy <p>',
      'Severity policy: dev (CRITICAL blocks) | ci (CRITICAL+HIGH, default) | strict (+MEDIUM). ' +
        'Named --policy because --profile is the global auth-profile flag.',
    )
    .option('--fix', 'Apply mechanical normalize fixes (node ids, log settings) in place, then validate')
    .action(withAction<ValidateOpts>(validateHandler));
}
