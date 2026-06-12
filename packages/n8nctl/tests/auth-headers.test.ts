import { describe, it, expect } from 'vitest';
import { buildAuthHeaders } from '../src/commands/workflow/trigger-webhook.js';
import { ValidationError } from '../src/lib/errors.js';

describe('buildAuthHeaders', () => {
  it('builds a Bearer header', () => {
    expect(buildAuthHeaders({ authBearer: 'tok' })).toEqual({ Authorization: 'Bearer tok' });
  });

  it('builds a Basic header (base64 of user:pass)', () => {
    const h = buildAuthHeaders({ authBasic: 'user:pass' });
    expect(h.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
  });

  it('builds custom headers from repeatable --auth-header', () => {
    const h = buildAuthHeaders({ authHeader: ['X-Key: abc', 'X-Env: prod'] });
    expect(h).toEqual({ 'X-Key': 'abc', 'X-Env': 'prod' });
  });

  // Regression: --auth-bearer + --auth-basic both set Authorization; basic
  // silently won because it was processed second. Now an explicit error.
  it('rejects --auth-bearer combined with --auth-basic', () => {
    expect(() => buildAuthHeaders({ authBearer: 'tok', authBasic: 'u:p' })).toThrow(ValidationError);
    expect(() => buildAuthHeaders({ authBearer: 'tok', authBasic: 'u:p' })).toThrow(/auth-bearer.*auth-basic|mutually exclusive/i);
  });

  it('rejects malformed --auth-header without a colon', () => {
    expect(() => buildAuthHeaders({ authHeader: ['NoColonHere'] })).toThrow(ValidationError);
  });
});
