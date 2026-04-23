import { describe, it, expect } from 'vitest';
import { validate } from '../src/validator.js';

function mkNode(name: string, type = 'n8n-nodes-base.set', overrides: Record<string, unknown> = {}) {
  return {
    id: name,
    name,
    type,
    typeVersion: 3,
    position: [0, 0] as [number, number],
    parameters: {},
    ...overrides,
  };
}

describe('Layer 2 (referential integrity) — E020-E027', () => {
  it('E020: connection from non-existent source node', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('Exists')],
      connections: {
        'Ghost': { main: [[{ node: 'Exists', type: 'main', index: 0 }]] },
      },
    });
    expect(r.issues.some((i) => i.code === 'E020')).toBe(true);
  });

  it('E021: source connection value is not an object', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A'), mkNode('B')],
      connections: { A: 'bogus' as unknown as Record<string, unknown> },
    });
    expect(r.issues.some((i) => i.code === 'E021')).toBe(true);
  });

  it('E022: output type value is not an array', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A')],
      connections: { A: { main: 'not-array' as unknown as unknown[] } },
    });
    expect(r.issues.some((i) => i.code === 'E022')).toBe(true);
  });

  it('E023: output group is not an array', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A')],
      connections: { A: { main: ['not-array' as unknown as unknown[]] } },
    });
    expect(r.issues.some((i) => i.code === 'E023')).toBe(true);
  });

  it('E024: link in group is not an object', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A')],
      connections: { A: { main: [['not-object' as unknown as object]] } },
    });
    expect(r.issues.some((i) => i.code === 'E024')).toBe(true);
  });

  it('E025: target node does not exist', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A')],
      connections: {
        A: { main: [[{ node: 'NonExistent', type: 'main', index: 0 }]] },
      },
    });
    expect(r.issues.some((i) => i.code === 'E025')).toBe(true);
  });

  it('E026: link missing numeric index', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A'), mkNode('B')],
      connections: {
        A: { main: [[{ node: 'B', type: 'main' }]] },
      },
    });
    expect(r.issues.some((i) => i.code === 'E026')).toBe(true);
  });

  it('E027: link missing type string', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A'), mkNode('B')],
      connections: {
        A: { main: [[{ node: 'B', index: 0 }]] },
      },
    });
    expect(r.issues.some((i) => i.code === 'E027')).toBe(true);
  });

  it('no false positive when connections are well-formed', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A'), mkNode('B')],
      connections: {
        A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
      },
    });
    expect(r.issues.filter((i) => i.code.startsWith('E02')).length).toBe(0);
  });
});

describe('Layer 2 (orphan detection) — E030', () => {
  it('flags orphan non-trigger node', () => {
    const r = validate({
      name: 't',
      nodes: [
        mkNode('Trigger', 'n8n-nodes-base.manualTrigger', { typeVersion: 1 }),
        mkNode('OrphanNode'), // neither connected nor a trigger-like
      ],
      connections: {},
    });
    expect(r.issues.some((i) => i.code === 'E030')).toBe(true);
  });

  it('does NOT flag trigger-like nodes (schedule/webhook/manual)', () => {
    const r = validate({
      name: 't',
      nodes: [
        mkNode('ManualTrigger', 'n8n-nodes-base.manualTrigger', { typeVersion: 1 }),
        mkNode('WebhookTrigger', 'n8n-nodes-base.webhook', { typeVersion: 1 }),
        mkNode('Schedule', 'n8n-nodes-base.scheduleTrigger', { typeVersion: 1 }),
      ],
      connections: {},
    });
    expect(r.issues.filter((i) => i.code === 'E030').length).toBe(0);
  });

  it('does NOT flag nodes that have outgoing connections', () => {
    const r = validate({
      name: 't',
      nodes: [mkNode('A'), mkNode('B')],
      connections: {
        A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
      },
    });
    expect(r.issues.filter((i) => i.code === 'E030').length).toBe(0);
  });
});

describe('Layer 3 (expressions) — E040', () => {
  it('flags unbalanced {{ (too many opens)', () => {
    const r = validate({
      name: 't',
      nodes: [
        mkNode('A', 'n8n-nodes-base.set', {
          parameters: { text: '={{ $json.x {{' },
        }),
      ],
      connections: {},
    });
    expect(r.issues.some((i) => i.code === 'E040')).toBe(true);
  });

  it('flags unbalanced }} (too many closes)', () => {
    const r = validate({
      name: 't',
      nodes: [
        mkNode('A', 'n8n-nodes-base.set', {
          parameters: { text: '={{ $json.x }} }}' },
        }),
      ],
      connections: {},
    });
    expect(r.issues.some((i) => i.code === 'E040')).toBe(true);
  });

  it('passes balanced expressions', () => {
    const r = validate({
      name: 't',
      nodes: [
        mkNode('A', 'n8n-nodes-base.set', {
          parameters: { text: '={{ $json.a }} + {{ $json.b }}' },
        }),
      ],
      connections: {},
    });
    expect(r.issues.filter((i) => i.code === 'E040').length).toBe(0);
  });

  it('does NOT count JSON structural braces as expression braces', () => {
    const r = validate({
      name: 't',
      nodes: [
        mkNode('A', 'n8n-nodes-base.set', {
          parameters: { text: '{"a": 1}' }, // literal JSON, no {{ }}
        }),
      ],
      connections: {},
    });
    expect(r.issues.filter((i) => i.code === 'E040').length).toBe(0);
  });
});
