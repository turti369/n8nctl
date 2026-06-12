import { describe, it, expect } from 'vitest';
import {
  verifyExecution,
  parseExpectation,
  expectationFromFlags,
} from '../src/lib/lifecycle/verify.js';
import { ExitCode } from '../src/lib/errors.js';
import { ValidationError } from '../src/lib/errors.js';

/** Build an execution in the n8n public-API shape (includeData=true). */
function makeExec(over: Record<string, unknown> = {}, runData?: Record<string, unknown>, lastNode?: string) {
  return {
    id: 'e1',
    finished: true,
    status: 'success',
    mode: 'manual',
    workflowId: 'w1',
    startedAt: '2026-06-12T10:00:00.000Z',
    stoppedAt: '2026-06-12T10:00:05.000Z',
    data: runData
      ? { resultData: { runData, lastNodeExecuted: lastNode ?? Object.keys(runData).at(-1) } }
      : undefined,
    ...over,
  };
}

const okRun = (items: Array<Record<string, unknown>>) => [
  { startTime: 0, executionTime: 12, data: { main: [items.map((json) => ({ json }))] } },
];

describe('ExitCode.AssertionFailed', () => {
  it('is 6 — distinct from infra errors 1-5', () => {
    expect(ExitCode.AssertionFailed).toBe(6);
  });
});

describe('verifyExecution — CẦN tier (ported 1:1 from test-gate.js)', () => {
  it('passes a finished success execution with last-node output', () => {
    const exec = makeExec({}, { Done: okRun([{ a: 1 }]) }, 'Done');
    const r = verifyExecution(exec, { version: 'v1' });
    expect(r.gate).toBe('PASS');
    expect(r.pass).toBe(true);
  });

  it('fails CẦN when execution is not finished (running)', () => {
    const exec = makeExec({ finished: false, status: 'running', stoppedAt: null });
    const r = verifyExecution(exec, { version: 'v1' });
    expect(r.gate).toBe('FAIL_CAN');
    expect(r.checks.some((c) => c.tier === 'can' && c.status === 'FAIL' && /not finished/.test(c.msg))).toBe(true);
  });

  it('fails CẦN with a waiting hint when execution is waiting', () => {
    const exec = makeExec({ finished: false, status: 'waiting', waitTill: '2026-06-13T00:00:00Z' });
    const r = verifyExecution(exec, { version: 'v1' });
    expect(r.gate).toBe('FAIL_CAN');
    expect(r.checks.some((c) => /waiting/.test(c.msg))).toBe(true);
  });

  it('fails CẦN on error status', () => {
    const exec = makeExec({ status: 'error' }, { Done: okRun([{ a: 1 }]) }, 'Done');
    const r = verifyExecution(exec, { version: 'v1' });
    expect(r.gate).toBe('FAIL_CAN');
  });

  it('fails CẦN listing node errors from runData', () => {
    const exec = makeExec({}, {
      Good: okRun([{ a: 1 }]),
      Bad: [{ startTime: 0, executionTime: 5, error: { message: 'boom' } }],
    }, 'Bad');
    const r = verifyExecution(exec, { version: 'v1' });
    expect(r.gate).toBe('FAIL_CAN');
    expect(r.checks.some((c) => /Bad\[0\]: boom/.test(c.msg))).toBe(true);
  });

  it('fails CẦN when the last node produced zero items', () => {
    const exec = makeExec({}, { Done: okRun([]) }, 'Done');
    const r = verifyExecution(exec, { version: 'v1' });
    expect(r.gate).toBe('FAIL_CAN');
    expect(r.checks.some((c) => /no output items/.test(c.msg))).toBe(true);
  });

  it('fails CLOSED when execution data is unavailable (pruned / saveData off)', () => {
    const exec = makeExec({ data: undefined });
    const r = verifyExecution(exec, { version: 'v1' });
    expect(r.gate).toBe('FAIL_CAN');
    expect(r.dataAvailable).toBe(false);
    expect(r.checks.some((c) => /data unavailable/i.test(c.msg))).toBe(true);
  });

  it('skips last-node check when expectation disables it (superset)', () => {
    const exec = makeExec({}, { Done: okRun([]) }, 'Done');
    const r = verifyExecution(exec, { version: 'v1', lastNodeOutput: false });
    expect(r.gate).toBe('PASS');
  });
});

describe('verifyExecution — ĐỦ tier (fields)', () => {
  const exec = () => makeExec({}, { Done: okRun([{ title: 'T', url: 'u', empty: null }]) }, 'Done');

  it('passes when all expected fields are present and non-null', () => {
    const r = verifyExecution(exec(), { version: 'v1', fields: ['title', 'url'] });
    expect(r.gate).toBe('PASS');
  });

  it('fails ĐỦ listing missing and null fields', () => {
    const r = verifyExecution(exec(), { version: 'v1', fields: ['title', 'missing', 'empty'] });
    expect(r.gate).toBe('FAIL_DU');
    expect(r.checks.some((c) => c.tier === 'du' && /missing, empty/.test(c.msg))).toBe(true);
  });
});

describe('verifyExecution — TỐT tier (duration)', () => {
  it('warns (gate still passes) when duration exceeds budget', () => {
    const exec = makeExec({}, { Done: okRun([{ a: 1 }]) }, 'Done'); // 5000ms span
    const r = verifyExecution(exec, { version: 'v1', maxDurationMs: 1000 });
    expect(r.gate).toBe('WARN_TOT');
    expect(r.pass).toBe(true);
  });

  it('escalates to gate failure with failOnSlow', () => {
    const exec = makeExec({}, { Done: okRun([{ a: 1 }]) }, 'Done');
    const r = verifyExecution(exec, { version: 'v1', maxDurationMs: 1000, failOnSlow: true });
    expect(r.gate).toBe('FAIL_DU');
    expect(r.pass).toBe(false);
  });
});

describe('verifyExecution — per-node assertions (superset)', () => {
  const exec = () => makeExec({}, { A: okRun([{ x: 1 }, { x: 2 }]), B: okRun([{ y: 1 }]) }, 'B');

  it('asserts a node ran with minItems', () => {
    const r = verifyExecution(exec(), { version: 'v1', nodes: [{ name: 'A', minItems: 2 }] });
    expect(r.gate).toBe('PASS');
  });

  it('fails when an asserted node did not run', () => {
    const r = verifyExecution(exec(), { version: 'v1', nodes: [{ name: 'Ghost' }] });
    expect(r.gate).toBe('FAIL_CAN');
  });

  it('fails when a ran:false node DID run', () => {
    const r = verifyExecution(exec(), { version: 'v1', nodes: [{ name: 'B', ran: false }] });
    expect(r.gate).toBe('FAIL_CAN');
  });

  it('fails when minItems is not met', () => {
    const r = verifyExecution(exec(), { version: 'v1', nodes: [{ name: 'B', minItems: 5 }] });
    expect(r.gate).toBe('FAIL_CAN');
  });
});

describe('parseExpectation / expectationFromFlags', () => {
  it('accepts a v1 document', () => {
    const e = parseExpectation({ version: 'v1', fields: ['a'] });
    expect(e.fields).toEqual(['a']);
  });

  it('rejects unknown versions (schema is versioned from day one)', () => {
    expect(() => parseExpectation({ version: 'v9' })).toThrow(ValidationError);
    expect(() => parseExpectation({})).toThrow(ValidationError);
  });

  it('rejects non-object documents', () => {
    expect(() => parseExpectation('nope')).toThrow(ValidationError);
  });

  it('builds an expectation from CLI flags (script-compat path)', () => {
    const e = expectationFromFlags({ expectFields: 'title, url', maxDurationMs: 5000 });
    expect(e.fields).toEqual(['title', 'url']);
    expect(e.maxDurationMs).toBe(5000);
  });
});
