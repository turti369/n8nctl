import { describe, it, expect } from 'vitest';
import { validate } from '../src/validator.js';
import type { NodeCatalog } from '../src/types.js';

const MINIMAL_WORKFLOW = {
  name: 'Test',
  nodes: [
    {
      id: 'a',
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
  ],
  connections: {},
};

describe('validate', () => {
  it('passes a minimal valid workflow', () => {
    const r = validate(MINIMAL_WORKFLOW);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.nodeCount).toBe(1);
  });

  it('fails on missing nodes array', () => {
    const r = validate({ name: 'x', connections: {} });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'E002')).toBe(true);
  });

  it('fails on null workflow', () => {
    const r = validate(null);
    expect(r.valid).toBe(false);
    expect(r.issues[0].code).toBe('E001');
  });

  it('detects duplicate node names', () => {
    const r = validate({
      name: 't',
      nodes: [
        { id: 'a', name: 'X', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'X', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [1, 0], parameters: {} },
      ],
      connections: {},
    });
    expect(r.issues.some((i) => i.code === 'E013')).toBe(true);
  });

  it('detects unbalanced expression braces', () => {
    const r = validate({
      name: 't',
      nodes: [
        {
          id: 'a',
          name: 'X',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          position: [0, 0],
          parameters: { assignments: {}, mode: '={{ $json.value }' },
        },
      ],
      connections: {},
    });
    expect(r.issues.some((i) => i.code === 'E040')).toBe(true);
  });

  it('flags hardcoded Bearer token', () => {
    const r = validate({
      name: 't',
      nodes: [
        {
          id: 'a',
          name: 'X',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [0, 0],
          parameters: { method: 'GET', url: 'https://x', headers: 'Authorization: Bearer abcdef1234567890abcdef' },
        },
      ],
      connections: {},
    });
    expect(r.issues.some((i) => i.code === 'E050')).toBe(true);
  });

  it('Layer 6: catches wrong type on required field', () => {
    const catalog: NodeCatalog = {
      nodes: {
        'n8n-nodes-base.httpRequest': {
          typeVersion: [4.2],
          required: { method: 'string', url: 'string' },
          optional: {},
        },
      },
    };
    const r = validate(
      {
        name: 't',
        nodes: [
          {
            id: 'a',
            name: 'HTTP',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.2,
            position: [0, 0],
            parameters: { method: 'GET', url: 12345 },
          },
        ],
        connections: {},
      },
      { catalog },
    );
    expect(r.issues.some((i) => i.code === 'E062')).toBe(true);
  });

  it('Layer 6: allows expression ={{ }} to skip type check', () => {
    const catalog: NodeCatalog = {
      nodes: {
        'n8n-nodes-base.httpRequest': {
          typeVersion: [4.2],
          required: { method: 'string', url: 'string' },
          optional: {},
        },
      },
    };
    const r = validate(
      {
        name: 't',
        nodes: [
          {
            id: 'a',
            name: 'HTTP',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.2,
            position: [0, 0],
            parameters: { method: 'GET', url: '={{ $json.url }}' },
          },
        ],
        connections: {},
      },
      { catalog },
    );
    expect(r.valid).toBe(true);
  });

  it('Layer 6: catches invalid enum value', () => {
    const catalog: NodeCatalog = {
      nodes: {
        'n8n-nodes-base.httpRequest': {
          typeVersion: [4.2],
          required: { method: 'string', url: 'string' },
          optional: {},
          enums: { method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        },
      },
    };
    const r = validate(
      {
        name: 't',
        nodes: [
          {
            id: 'a',
            name: 'HTTP',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.2,
            position: [0, 0],
            parameters: { method: 'GETT', url: 'https://x' },
          },
        ],
        connections: {},
      },
      { catalog },
    );
    expect(r.issues.some((i) => i.code === 'E064')).toBe(true);
  });
});
