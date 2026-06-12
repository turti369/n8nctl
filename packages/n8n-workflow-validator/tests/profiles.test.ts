import { describe, it, expect } from 'vitest';
import { validate } from '../src/index.js';

// A workflow that yields exactly one MEDIUM (E070 settings) + one LOW (E071 id)
const wfMediumOnly = {
  name: 'p',
  nodes: [
    {
      id: 'not-a-uuid',
      name: 'Manual',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
  ],
  connections: {},
};

describe('severity profiles', () => {
  it('ci (default) passes MEDIUM-only workflows', () => {
    const r = validate(wfMediumOnly);
    expect(r.issues.some((i) => i.code === 'E070')).toBe(true);
    expect(r.valid).toBe(true);
  });

  it('strict profile blocks MEDIUM', () => {
    expect(validate(wfMediumOnly, { profile: 'strict' }).valid).toBe(false);
  });

  it('strict:true stays a back-compat alias of profile strict', () => {
    expect(validate(wfMediumOnly, { strict: true }).valid).toBe(false);
  });

  it('dev profile blocks only CRITICAL', () => {
    const broken = { name: 'x' }; // structurally broken → CRITICAL/HIGH
    const r = validate(broken, { profile: 'dev' });
    // dev still fails on CRITICAL-level structural problems
    expect(validate(wfMediumOnly, { profile: 'dev' }).valid).toBe(true);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('annotates E070/E071 as fixable (normalize can clear them)', () => {
    const r = validate(wfMediumOnly);
    const e070 = r.issues.find((i) => i.code === 'E070');
    const e071 = r.issues.find((i) => i.code === 'E071');
    expect(e070?.fixable).toBe(true);
    expect(e071?.fixable).toBe(true);
  });
});
