import { validate as runValidate, type ValidationIssue } from '@trngthnh369/n8n-workflow-validator';
import { ValidationError } from './errors.js';
import { c } from './io.js';
import { readConfigSync } from './config.js';
import { resolveSyncedCatalog } from './validator-catalog.js';
import type { Factory } from '../factory.js';

const POLICIES = ['dev', 'ci', 'strict'] as const;
export type ValidatePolicy = (typeof POLICIES)[number];

export interface AutoValidateOpts {
  /** Commander maps `--no-validate` → { validate: false }. Default: validate (warn). */
  validate?: boolean;
  /** `--validate-policy <p>`: when set, validation BLOCKS (exit 3) per policy. */
  validatePolicy?: string;
}

/**
 * Validate a workflow on the DEPLOY path (create/update/import/promote).
 *
 * Default is WARN-ONLY: issues are printed to stderr but never block — a
 * previously-working deploy keeps working, so wiring validation in is additive.
 * Passing `--validate-policy <dev|ci|strict>` switches to BLOCK mode (throws
 * ValidationError → exit 3 when the policy is violated). `--no-validate` skips.
 *
 * Why warn-default (and not block): E050 (hardcoded-secret) is CRITICAL, and
 * CRITICAL blocks in EVERY policy including `dev`. Its generic pattern has false
 * positives on benign already-live workflows, so a blocking default would break
 * working promotes/updates with no policy-flag escape (only `--no-validate`
 * clears CRITICAL). Warn-default keeps the feature additive; opt into blocking
 * when you want a hard gate.
 */
export function autoValidate(factory: Factory, workflow: unknown, opts: AutoValidateOpts): void {
  if (opts.validate === false) return; // --no-validate

  const policyGiven = opts.validatePolicy !== undefined;
  if (policyGiven && !POLICIES.includes(opts.validatePolicy as ValidatePolicy)) {
    throw new ValidationError(
      `Unknown --validate-policy "${opts.validatePolicy}"`,
      `Pick one of: ${POLICIES.join(', ')}`,
    );
  }
  // Display/enforce at the requested policy; default 'ci' for what to surface.
  const policy = (policyGiven ? opts.validatePolicy : 'ci') as ValidatePolicy;
  // Use the active profile's synced catalog if present (else validator bundled).
  const profileName = factory.flags.profile ?? readConfigSync().activeProfile ?? 'default';
  const catalog = resolveSyncedCatalog(profileName);
  const result = runValidate(workflow, { profile: policy, ...(catalog ? { catalog } : {}) });
  if (result.issues.length === 0) return;

  renderValidationIssues(factory, result.issues);

  if (policyGiven && !result.valid) {
    throw new ValidationError(
      `Validation failed (--validate-policy ${policy})`,
      'Fix the issues above, lower the policy, or pass --no-validate to skip.',
    );
  }

  // Warn-default: surfaced, not blocking.
  const blocking = result.issues.filter(
    (i) => i.severity === 'CRITICAL' || i.severity === 'HIGH',
  ).length;
  if (blocking > 0) {
    factory.io.stderr.write(
      `${c.yellow('warning')}: ${blocking} blocking-severity validation issue(s) — proceeding ` +
        `(warn-only). Pass --validate-policy ci to enforce, or --no-validate to silence.\n`,
    );
  }
}

/** Render validation issues to stderr (shared warn renderer). */
export function renderValidationIssues(factory: Factory, issues: ValidationIssue[]): void {
  factory.io.stderr.write(`${c.dim('→ validate:')}\n`);
  issues.forEach((e, i) => {
    const color = e.severity === 'CRITICAL' ? c.red : e.severity === 'HIGH' ? c.yellow : c.dim;
    const fixable = e.fixable ? c.dim(' (fixable — n8nctl workflow normalize)') : '';
    factory.io.stderr.write(
      `  ${i + 1}. ${color(`[${e.severity}]`)} ${e.code}: ${e.msg}${fixable}\n`,
    );
  });
}
