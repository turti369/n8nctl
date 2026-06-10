import { describe, it, expect } from 'vitest';
import { normalizeWorkflow, DEFAULT_SETTINGS } from '../src/lib/normalize.js';
import type { Workflow } from '../src/types/n8n.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wf(over: Partial<Workflow> = {}): Workflow {
  return {
    id: 'x',
    name: 'T',
    active: false,
    nodes: [
      { id: '1', name: 'Manual', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      { id: 'm2', name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [1, 0], parameters: {} },
    ],
    connections: {},
    ...over,
  } as Workflow;
}

describe('normalizeWorkflow — node ids', () => {
  it('replaces non-UUID ids with UUID format', () => {
    const { workflow, changes } = normalizeWorkflow(wf());
    for (const n of workflow.nodes) expect(n.id).toMatch(UUID_RE);
    expect(changes.some((c) => /id/.test(c))).toBe(true);
  });

  it('is deterministic — same input yields identical ids (no churn on re-run)', () => {
    const a = normalizeWorkflow(wf()).workflow;
    const b = normalizeWorkflow(wf()).workflow;
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id));
  });

  it('is idempotent — normalizing twice is a no-op the second time', () => {
    const once = normalizeWorkflow(wf()).workflow;
    const twice = normalizeWorkflow(once);
    expect(twice.changes.some((c) => /id/.test(c))).toBe(false);
    expect(twice.workflow.nodes.map((n) => n.id)).toEqual(once.nodes.map((n) => n.id));
  });

  it('keeps already-valid UUID ids stable', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const input = wf({ nodes: [{ id: uuid, name: 'A', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [0, 0], parameters: {} }] as never });
    const { workflow } = normalizeWorkflow(input);
    expect(workflow.nodes[0].id).toBe(uuid);
  });

  it('distinct node names get distinct ids', () => {
    const { workflow } = normalizeWorkflow(wf());
    const ids = new Set(workflow.nodes.map((n) => n.id));
    expect(ids.size).toBe(workflow.nodes.length);
  });
});

describe('normalizeWorkflow — settings', () => {
  it('injects execution-log defaults when settings missing', () => {
    const { workflow, changes } = normalizeWorkflow(wf({ settings: undefined }));
    expect(workflow.settings).toMatchObject(DEFAULT_SETTINGS);
    expect(changes.some((c) => /settings/.test(c))).toBe(true);
  });

  it('does NOT overwrite an explicit setting value', () => {
    const { workflow } = normalizeWorkflow(wf({ settings: { saveDataErrorExecution: 'none' } as never }));
    expect((workflow.settings as Record<string, unknown>).saveDataErrorExecution).toBe('none');
    // but still fills the other missing keys
    expect((workflow.settings as Record<string, unknown>).saveManualExecutions).toBe(true);
  });

  it('no settings change when all keys already present', () => {
    const full = { ...DEFAULT_SETTINGS };
    const { changes } = normalizeWorkflow(wf({ settings: full as never }));
    expect(changes.some((c) => /settings/.test(c))).toBe(false);
  });
});

describe('normalizeWorkflow — safety', () => {
  it('does not mutate the input object', () => {
    const input = wf();
    const before = JSON.stringify(input);
    normalizeWorkflow(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does NOT touch typeVersion (left to E072 warn / build-time)', () => {
    const { workflow } = normalizeWorkflow(wf());
    expect(workflow.nodes[1].typeVersion).toBe(3.4); // unchanged
  });

  it('handles a workflow with no nodes', () => {
    const { workflow, changes } = normalizeWorkflow(wf({ nodes: [] }));
    expect(workflow.nodes).toEqual([]);
    // settings still injected
    expect(changes.some((c) => /settings/.test(c))).toBe(true);
  });
});
