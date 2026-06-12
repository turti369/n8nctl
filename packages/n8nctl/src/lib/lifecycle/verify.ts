import { ValidationError } from '../errors.js';

/**
 * Cần+Đủ+Tốt execution gate — ported 1:1 from the external
 * `_pipeline/test-gate.js` consumed by the n8n-test skill, then extended
 * (versioned schema, per-node assertions, fail-closed on missing data).
 *
 * Pure module: no I/O, no printing, no process.exitCode — commands wrap it.
 * Kept under lib/lifecycle/ so a future `pipeline` command can compose it.
 */

export interface NodeExpectation {
  /** Node NAME as shown in n8n. */
  name: string;
  /** true (default) = must have run; false = must NOT have run. */
  ran?: boolean;
  /** Minimum number of output items on the first run's main output. */
  minItems?: number;
}

export interface Expectation {
  version: 'v1';
  /** CẦN — require no node errors (default true → any node error fails). */
  nodeErrors?: boolean;
  /** CẦN — require the last executed node to produce ≥1 item (default true). */
  lastNodeOutput?: boolean;
  /** ĐỦ — fields that must exist non-null on the first item of the last node. */
  fields?: string[];
  /** TỐT — duration budget in ms (warning unless failOnSlow). */
  maxDurationMs?: number;
  /** Escalate a blown duration budget from warning to gate failure. */
  failOnSlow?: boolean;
  /** Superset: per-node assertions. */
  nodes?: NodeExpectation[];
}

export interface VerifyCheck {
  tier: 'can' | 'du' | 'tot';
  status: 'OK' | 'FAIL' | 'WARN';
  msg: string;
}

export type GateResult = 'PASS' | 'WARN_TOT' | 'FAIL_DU' | 'FAIL_CAN';

export interface VerifyReport {
  executionId: string;
  gate: GateResult;
  /** true when the gate did not FAIL (WARN_TOT still passes). */
  pass: boolean;
  checks: VerifyCheck[];
  durationMs?: number;
  /** false when execution data was pruned/disabled — gate fails CLOSED. */
  dataAvailable: boolean;
}

/** Minimal structural view of an n8n execution (public API, includeData=true). */
export interface ExecutionLike {
  id?: string;
  finished?: boolean;
  status?: string;
  startedAt?: string;
  stoppedAt?: string | null;
  waitTill?: string | null;
  data?: unknown;
}

interface RunEntry {
  error?: { message?: string; name?: string };
  executionTime?: number;
  data?: { main?: Array<Array<{ json?: unknown }> | null> };
}

type RunData = Record<string, RunEntry[]>;

function getResultData(exec: ExecutionLike): { runData: RunData; lastNodeExecuted?: string } | null {
  const data = exec.data as { resultData?: { runData?: RunData; lastNodeExecuted?: string } } | undefined;
  if (!data || typeof data !== 'object' || !data.resultData || typeof data.resultData !== 'object') {
    return null;
  }
  return {
    runData: data.resultData.runData ?? {},
    lastNodeExecuted: data.resultData.lastNodeExecuted,
  };
}

export function verifyExecution(exec: ExecutionLike, expect: Expectation): VerifyReport {
  const checks: VerifyCheck[] = [];
  const add = (tier: VerifyCheck['tier'], status: VerifyCheck['status'], msg: string): void => {
    checks.push({ tier, status, msg });
  };

  // ============ CẦN (must) ============
  if (exec.finished !== true) {
    const waiting = exec.status === 'waiting' || Boolean(exec.waitTill);
    add(
      'can',
      'FAIL',
      `execution not finished (status: ${exec.status ?? 'unknown'})${waiting ? ' — waiting for an external event/timer' : ''}`,
    );
  } else {
    add('can', 'OK', 'execution finished');
  }

  if (exec.status === 'error' || exec.status === 'crashed') {
    add('can', 'FAIL', `execution ended in ${exec.status} status`);
  }

  const result = getResultData(exec);
  const dataAvailable = result !== null;

  if (!dataAvailable) {
    // Fail CLOSED: without runData we cannot evidence "no node errors" or
    // last-node output. Common cause: saveDataSuccessExecution 'none' or a
    // pruned execution.
    add(
      'can',
      'FAIL',
      'execution data unavailable — cannot evidence node results (enable saveDataSuccessExecution/saveDataErrorExecution or verify a fresher execution)',
    );
  } else {
    const { runData, lastNodeExecuted } = result;

    if (expect.nodeErrors !== true) {
      const failedNodes: string[] = [];
      for (const [nodeName, runs] of Object.entries(runData)) {
        (runs ?? []).forEach((run, ri) => {
          if (run?.error) {
            failedNodes.push(`${nodeName}[${ri}]: ${run.error.message ?? run.error.name ?? 'error'}`);
          }
        });
      }
      if (failedNodes.length > 0) {
        add('can', 'FAIL', `${failedNodes.length} node error(s): ${failedNodes.slice(0, 3).join('; ')}`);
      } else {
        add('can', 'OK', 'no node errors');
      }
    }

    if (expect.lastNodeOutput !== false) {
      const lastRun = lastNodeExecuted ? runData[lastNodeExecuted]?.[0] : undefined;
      const lastOutput = lastRun?.data?.main?.[0] ?? [];
      if (!Array.isArray(lastOutput) || lastOutput.length === 0) {
        add('can', 'FAIL', `last node "${lastNodeExecuted ?? '(unknown)'}" produced no output items`);
      } else {
        add('can', 'OK', `last node produced ${lastOutput.length} item(s)`);
      }
    }

    for (const nodeExpect of expect.nodes ?? []) {
      const runs = runData[nodeExpect.name];
      const ran = Array.isArray(runs) && runs.length > 0;
      const mustRun = nodeExpect.ran !== false;
      if (mustRun && !ran) {
        add('can', 'FAIL', `node "${nodeExpect.name}" did not run`);
        continue;
      }
      if (!mustRun && ran) {
        add('can', 'FAIL', `node "${nodeExpect.name}" ran but was expected NOT to`);
        continue;
      }
      if (!mustRun && !ran) {
        add('can', 'OK', `node "${nodeExpect.name}" did not run (as expected)`);
        continue;
      }
      const items = runs[0]?.data?.main?.[0] ?? [];
      if (nodeExpect.minItems !== undefined && (!Array.isArray(items) || items.length < nodeExpect.minItems)) {
        add(
          'can',
          'FAIL',
          `node "${nodeExpect.name}" produced ${Array.isArray(items) ? items.length : 0} item(s), expected >= ${nodeExpect.minItems}`,
        );
      } else {
        add('can', 'OK', `node "${nodeExpect.name}" ran${nodeExpect.minItems !== undefined ? ` with >= ${nodeExpect.minItems} item(s)` : ''}`);
      }
    }

    // ============ ĐỦ (should) ============
    if (expect.fields && expect.fields.length > 0) {
      const lastRun = lastNodeExecuted ? runData[lastNodeExecuted]?.[0] : undefined;
      const lastOutput = lastRun?.data?.main?.[0] ?? [];
      const firstItem = (lastOutput[0]?.json ?? {}) as Record<string, unknown>;
      const missing = expect.fields.filter((f) => !(f in firstItem) || firstItem[f] == null);
      if (missing.length > 0) {
        add('du', 'FAIL', `missing/null expected fields: ${missing.join(', ')}`);
      } else {
        add('du', 'OK', `all ${expect.fields.length} expected field(s) present`);
      }
    }
  }

  // ============ TỐT (nice) ============
  let durationMs: number | undefined;
  if (exec.startedAt && exec.stoppedAt) {
    durationMs = new Date(exec.stoppedAt).getTime() - new Date(exec.startedAt).getTime();
  }
  if (expect.maxDurationMs !== undefined && durationMs !== undefined) {
    if (durationMs > expect.maxDurationMs) {
      add(expect.failOnSlow ? 'du' : 'tot', expect.failOnSlow ? 'FAIL' : 'WARN',
        `duration ${durationMs}ms exceeds ${expect.maxDurationMs}ms`);
    } else {
      add('tot', 'OK', `duration ${durationMs}ms within budget`);
    }
  }

  const canFail = checks.some((c) => c.tier === 'can' && c.status === 'FAIL');
  const duFail = checks.some((c) => c.tier === 'du' && c.status === 'FAIL');
  const totWarn = checks.some((c) => c.tier === 'tot' && c.status === 'WARN');
  const gate: GateResult = canFail ? 'FAIL_CAN' : duFail ? 'FAIL_DU' : totWarn ? 'WARN_TOT' : 'PASS';

  return {
    executionId: String(exec.id ?? ''),
    gate,
    pass: gate === 'PASS' || gate === 'WARN_TOT',
    checks,
    durationMs,
    dataAvailable,
  };
}

/** Validate + narrow an expectation document (JSON or YAML-parsed). */
export function parseExpectation(raw: unknown): Expectation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Expectation file must be a JSON/YAML object');
  }
  const doc = raw as Record<string, unknown>;
  if (doc.version !== 'v1') {
    throw new ValidationError(
      `Unsupported expectation version "${String(doc.version ?? '(missing)')}"`,
      'Add `version: v1` at the top of the expectation file.',
    );
  }
  const out: Expectation = { version: 'v1' };
  if (doc.nodeErrors !== undefined) out.nodeErrors = Boolean(doc.nodeErrors);
  if (doc.lastNodeOutput !== undefined) out.lastNodeOutput = Boolean(doc.lastNodeOutput);
  if (doc.fields !== undefined) {
    if (!Array.isArray(doc.fields) || doc.fields.some((f) => typeof f !== 'string')) {
      throw new ValidationError('`fields` must be an array of strings');
    }
    out.fields = doc.fields as string[];
  }
  if (doc.maxDurationMs !== undefined) {
    const n = Number(doc.maxDurationMs);
    if (!Number.isInteger(n) || n < 1) throw new ValidationError('`maxDurationMs` must be a positive integer');
    out.maxDurationMs = n;
  }
  if (doc.failOnSlow !== undefined) out.failOnSlow = Boolean(doc.failOnSlow);
  if (doc.nodes !== undefined) {
    if (!Array.isArray(doc.nodes)) throw new ValidationError('`nodes` must be an array');
    out.nodes = (doc.nodes as Array<Record<string, unknown>>).map((n, i) => {
      if (!n || typeof n !== 'object' || typeof n.name !== 'string' || !n.name) {
        throw new ValidationError(`\`nodes[${i}]\` must be an object with a non-empty \`name\``);
      }
      const ne: NodeExpectation = { name: n.name };
      if (n.ran !== undefined) ne.ran = Boolean(n.ran);
      if (n.minItems !== undefined) {
        const m = Number(n.minItems);
        if (!Number.isInteger(m) || m < 0) throw new ValidationError(`\`nodes[${i}].minItems\` must be a non-negative integer`);
        ne.minItems = m;
      }
      return ne;
    });
  }
  return out;
}

/** Script-compat path: build an expectation from --expect-fields / --max-duration-ms. */
export function expectationFromFlags(flags: {
  expectFields?: string;
  maxDurationMs?: number;
}): Expectation {
  const out: Expectation = { version: 'v1' };
  if (flags.expectFields) {
    out.fields = flags.expectFields
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (flags.maxDurationMs !== undefined) out.maxDurationMs = flags.maxDurationMs;
  return out;
}
