import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { parsePositiveInt } from '../../lib/util.js';
import { redactExecutionData } from '../../lib/redact-execution.js';
import {
  verifyExecution,
  parseExpectation,
  expectationFromFlags,
  type Expectation,
  type VerifyReport,
  type ExecutionLike,
} from '../../lib/lifecycle/verify.js';
import type { Factory } from '../../factory.js';
import type { Execution, PaginatedResponse } from '../../types/n8n.js';

interface VerifyOpts {
  execution?: string;
  expect?: string;
  expectFields?: string;
  maxDurationMs?: string | number;
  run?: boolean;
  trigger?: string;
  timeout?: string | number;
  capture?: string;
  unsafeRawIo?: boolean;
}

async function loadExpectFile(file: string): Promise<Expectation> {
  const absPath = path.resolve(file);
  const raw = await fs.readFile(absPath, 'utf8').catch((e) => {
    throw new ValidationError(`Cannot read expectation file ${absPath}: ${(e as Error).message}`);
  });
  let doc: unknown;
  try {
    doc = /\.ya?ml$/i.test(absPath) ? yaml.load(raw) : JSON.parse(raw);
  } catch (e) {
    throw new ValidationError(`Cannot parse expectation file ${absPath}: ${(e as Error).message}`);
  }
  return parseExpectation(doc);
}

/** Merge: file is the base, CLI flags layer on top (script-compat). */
function mergeExpectations(base: Expectation, flags: Expectation): Expectation {
  return {
    ...base,
    ...(flags.fields ? { fields: flags.fields } : {}),
    ...(flags.maxDurationMs !== undefined ? { maxDurationMs: flags.maxDurationMs } : {}),
  };
}

export async function verifyHandler(
  factory: Factory,
  opts: VerifyOpts,
  args: string[],
): Promise<void> {
  const [workflowId] = args;

  const flagExpectation = expectationFromFlags({
    expectFields: opts.expectFields,
    maxDurationMs:
      opts.maxDurationMs !== undefined
        ? parsePositiveInt(opts.maxDurationMs, '--max-duration-ms', 0, 1)
        : undefined,
  });
  const expectation = opts.expect
    ? mergeExpectations(await loadExpectFile(opts.expect), flagExpectation)
    : flagExpectation;

  if (factory.flags.dryRun) {
    const source = opts.execution
      ? `execution ${opts.execution}`
      : opts.run
        ? `new execution via /rest run${opts.trigger ? ` (trigger "${opts.trigger}")` : ''}`
        : `latest execution of workflow ${workflowId}`;
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would verify ${source} against ${JSON.stringify(expectation)}\n`,
    );
    return;
  }

  const client = await factory.client();

  // Resolve which execution to gate.
  let executionId = opts.execution;
  if (!executionId && opts.run) {
    const sc = await factory.sessionClient();
    const { executionId: newId } = await sc.runWorkflow(workflowId, opts.trigger);
    factory.io.event(
      'verify-run-started',
      { workflowId, executionId: newId },
      `${c.dim('→')} started execution ${newId}`,
    );
    const timeoutMs = parsePositiveInt(opts.timeout, '--timeout', 120000);
    await sc.waitExecution(newId, { timeoutMs });
    executionId = newId;
  }
  if (!executionId) {
    const resp = await client.get<PaginatedResponse<Execution>>('/executions', {
      workflowId,
      limit: 1,
    });
    const latest = resp.data[0];
    if (!latest) {
      throw new ValidationError(
        `Workflow ${workflowId} has no executions to verify`,
        'Trigger one first (workflow run / trigger-webhook) or pass --run.',
      );
    }
    executionId = latest.id;
  }

  // Always (re)fetch via the Public API with includeData — the gate needs runData.
  const exec = await client.get<ExecutionLike>(`/executions/${encodeURIComponent(executionId)}`, {
    includeData: true,
  });

  const report = verifyExecution(exec, expectation);

  if (opts.capture) {
    const payload = opts.unsafeRawIo ? { report, execution: exec } : redactExecutionData({ report, execution: exec });
    await fs.writeFile(path.resolve(opts.capture), JSON.stringify(payload, null, 2), 'utf8');
    factory.io.stderr.write(
      `${c.dim('→')} captured verify artifact → ${opts.capture}${opts.unsafeRawIo ? ' (RAW io — handle as secret)' : ' (redacted)'}\n`,
    );
  }

  if (factory.flags.json || factory.flags.jq || factory.flags.template) {
    await printData(report, { io: factory.io, opts: factory.flags });
  } else {
    renderReport(factory, report);
  }

  factory.io.event('verify-finished', {
    workflowId,
    executionId,
    gate: report.gate,
    pass: report.pass,
  });

  if (!report.pass) {
    // Assertion failure, not an infra error — exit 6 per docs/EXIT_CODES.md.
    process.exitCode = 6;
  }
}

function renderReport(factory: Factory, report: VerifyReport): void {
  const byTier = (tier: 'can' | 'du' | 'tot', label: string): void => {
    const rows = report.checks.filter((ch) => ch.tier === tier);
    if (rows.length === 0) return;
    factory.io.stdout.write(`\n${c.bold(`[${label}]`)}\n`);
    for (const r of rows) {
      const icon = r.status === 'OK' ? c.green('✓') : r.status === 'WARN' ? c.yellow('⚠') : c.red('✗');
      factory.io.stdout.write(`  ${icon} ${r.msg}\n`);
    }
  };
  byTier('can', 'CẦN (must)');
  byTier('du', 'ĐỦ (should)');
  byTier('tot', 'TỐT (nice)');

  factory.io.stdout.write('\n');
  const verdict =
    report.gate === 'FAIL_CAN'
      ? c.red('❌ GATE FAILED (CẦN)')
      : report.gate === 'FAIL_DU'
        ? c.red('⚠ GATE FAILED (ĐỦ)')
        : report.gate === 'WARN_TOT'
          ? c.yellow('⚠ GATE PASSED with TỐT warnings')
          : c.green('✓ GATE PASSED');
  factory.io.stdout.write(
    `${verdict} ${c.dim(`(execution ${report.executionId}${report.durationMs !== undefined ? `, ${report.durationMs}ms` : ''})`)}\n`,
  );
}

export function createVerifyCommand(): Command {
  return new Command('verify')
    .description(
      'Run the Cần+Đủ+Tốt gate against an execution: CẦN = finished, no node errors, ' +
        'last node produced output; ĐỦ = expected fields present; TỐT = duration budget. ' +
        'Exit 6 when the gate fails (infra errors stay 1-5). Replaces the external test-gate.js.',
    )
    .argument('<workflowId>', 'workflow ID (used to pick the latest execution unless --execution)')
    .option('--execution <id>', 'Verify this specific execution instead of the latest')
    .option('--expect <file>', 'Expectation file (JSON or YAML, `version: v1`)')
    .option('--expect-fields <a,b,c>', 'ĐỦ: comma-separated fields required non-null on the last node first item')
    .option('--max-duration-ms <n>', 'TỐT: duration budget in ms (warning unless failOnSlow in --expect file)')
    .option('--run', 'Execute the workflow first via /rest session mode, then verify that execution')
    .option('--trigger <name>', 'Trigger node name for --run (non-webhook trigger)')
    .option('--timeout <ms>', 'Wait timeout for --run (default 120000)')
    .option('--capture <file>', 'Write {report, execution} artifact to file (redacted by default)')
    .option('--unsafe-raw-io', 'Disable redaction in --capture output (handle file as a secret)')
    .action(withAction<VerifyOpts>(verifyHandler));
}
