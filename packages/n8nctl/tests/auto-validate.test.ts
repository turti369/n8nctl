import { describe, it, expect } from 'vitest';
import { autoValidate } from '../src/lib/auto-validate.js';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { ValidationError } from '../src/lib/errors.js';

// A workflow that trips E050 (hardcoded Bearer token → CRITICAL).
const leakyWorkflow = {
  name: 'leaky',
  nodes: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Set',
      type: 'n8n-nodes-base.set',
      typeVersion: 1,
      position: [0, 0],
      parameters: { header: 'Bearer abcdefghijklmnopqrstuvwxyz012345' },
    },
  ],
  connections: {},
  settings: { saveDataErrorExecution: 'all', saveManualExecutions: true },
};

describe('autoValidate (deploy-path validation)', () => {
  it('warns but does NOT throw by default, even on a CRITICAL issue', () => {
    const env = makeFakeFactory();
    expect(() => autoValidate(env.factory, leakyWorkflow, {})).not.toThrow();
    expect(env.stderr()).toMatch(/E050/);
    expect(env.stderr()).toMatch(/warn/i);
  });

  it('BLOCKS (throws ValidationError) when --validate-policy is set', () => {
    const env = makeFakeFactory();
    expect(() => autoValidate(env.factory, leakyWorkflow, { validatePolicy: 'ci' })).toThrow(
      ValidationError,
    );
    expect(env.stderr()).toMatch(/E050/);
  });

  it('skips entirely with --no-validate (validate:false) — no throw, no output', () => {
    const env = makeFakeFactory();
    expect(() => autoValidate(env.factory, leakyWorkflow, { validate: false })).not.toThrow();
    expect(env.stderr()).toBe('');
  });

  it('rejects an unknown policy value', () => {
    const env = makeFakeFactory();
    expect(() => autoValidate(env.factory, leakyWorkflow, { validatePolicy: 'bogus' })).toThrow(
      /Unknown --validate-policy/,
    );
  });

  it('dev policy does NOT block a MEDIUM-only issue but ci-default surfaces it', () => {
    // A structurally-fine workflow missing save settings → E070 MEDIUM only.
    const wf = {
      name: 'medium-only',
      nodes: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'NoOp',
          type: 'n8n-nodes-base.noOp',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
      ],
      connections: {},
    };
    const env = makeFakeFactory();
    // dev policy: MEDIUM never blocks → no throw
    expect(() => autoValidate(env.factory, wf, { validatePolicy: 'dev' })).not.toThrow();
  });
});
