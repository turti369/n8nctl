import { Command } from 'commander';
import { withAction } from '../lib/runtime.js';
import { printData } from '../lib/output.js';
import { ValidationError } from '../lib/errors.js';
import { parsePositiveInt } from '../lib/util.js';
import type { Factory } from '../factory.js';

interface AuditOpts {
  categories?: string;
  daysAbandoned?: string | number;
}

const VALID_CATEGORIES = ['credentials', 'database', 'nodes', 'filesystem', 'instance'] as const;

export async function auditHandler(
  factory: Factory,
  opts: AuditOpts,
  _args: string[],
): Promise<void> {
  const client = await factory.client();

  const additionalOptions: Record<string, unknown> = {};
  if (opts.categories) {
    const cats = opts.categories.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = cats.filter((cl) => !VALID_CATEGORIES.includes(cl as (typeof VALID_CATEGORIES)[number]));
    if (bad.length > 0) {
      throw new ValidationError(
        `Unknown audit categor${bad.length > 1 ? 'ies' : 'y'}: ${bad.join(', ')}`,
        `Valid: ${VALID_CATEGORIES.join(', ')}`,
      );
    }
    additionalOptions.categories = cats;
  }
  if (opts.daysAbandoned !== undefined) {
    additionalOptions.daysAbandonedWorkflow = parsePositiveInt(opts.daysAbandoned, '--days-abandoned', 90);
  }

  // POST, but report-generation only — no instance state is mutated.
  const report = await client.post<Record<string, unknown>>(
    '/audit',
    Object.keys(additionalOptions).length > 0 ? { additionalOptions } : {},
  );

  await printData(report, { io: factory.io, opts: factory.flags });
}

export function createAuditCommand(): Command {
  return new Command('audit')
    .description(
      'Generate the n8n security audit report (credentials risk, abandoned workflows, ' +
        'instance risks). Read-only: POST /audit only generates the report.',
    )
    .option('--categories <list>', `Comma-separated subset of: ${VALID_CATEGORIES.join(', ')}`)
    .option('--days-abandoned <n>', 'Days without execution before a workflow counts as abandoned (default: n8n server default 90)')
    .action(withAction<AuditOpts>(auditHandler));
}
