import { describe, it, expect } from 'vitest';
import { validate } from '../src/validator.js';
import type { NodeCatalog } from '../src/types.js';

const catalog: NodeCatalog = {
  nodes: {
    'n8n-nodes-base.code': {
      typeVersion: [1, 2],
      required: { jsCode: 'string' },
      optional: {
        mode: 'string',
        language: 'string',
        pythonCode: 'string',
      },
      enums: {
        mode: ['runOnceForAllItems', 'runOnceForEachItem'],
        language: ['javaScript', 'python'],
      },
      conditionalRequired: {
        pythonCode: { when: { language: 'python' }, type: 'string' },
      },
    },
  },
};

function wfWithCodeParams(parameters: Record<string, unknown>) {
  return {
    name: 't',
    nodes: [
      {
        id: 'a',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [0, 0],
        parameters,
      },
    ],
    connections: {},
  };
}

describe('Tier B #5: conditionalRequired', () => {
  it('flags E065 when condition met but field missing', () => {
    const r = validate(
      wfWithCodeParams({ jsCode: 'x', language: 'python' }),
      { catalog },
    );
    expect(r.issues.some((i) => i.code === 'E065')).toBe(true);
  });

  it('does not flag when condition NOT met', () => {
    const r = validate(
      wfWithCodeParams({ jsCode: 'return items', language: 'javaScript' }),
      { catalog },
    );
    expect(r.issues.some((i) => i.code === 'E065')).toBe(false);
  });

  it('does not flag when condition field is absent (condition not met)', () => {
    const r = validate(
      wfWithCodeParams({ jsCode: 'return items' }),
      { catalog },
    );
    expect(r.issues.some((i) => i.code === 'E065')).toBe(false);
  });

  it('flags E066 when condition met and field has wrong type', () => {
    const r = validate(
      wfWithCodeParams({
        jsCode: 'x',
        language: 'python',
        pythonCode: 12345,
      }),
      { catalog },
    );
    expect(r.issues.some((i) => i.code === 'E066')).toBe(true);
  });

  it('skips when condition field is an expression (runtime-only)', () => {
    const r = validate(
      wfWithCodeParams({
        jsCode: 'x',
        language: '={{ $json.lang }}',
      }),
      { catalog },
    );
    expect(r.issues.some((i) => i.code === 'E065')).toBe(false);
  });

  it('skips type check when field value is an expression', () => {
    const r = validate(
      wfWithCodeParams({
        jsCode: 'x',
        language: 'python',
        pythonCode: '={{ $json.code }}',
      }),
      { catalog },
    );
    expect(r.issues.some((i) => i.code === 'E066')).toBe(false);
  });
});
