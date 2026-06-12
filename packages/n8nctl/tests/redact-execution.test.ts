import { describe, it, expect } from 'vitest';
import { redactExecutionData } from '../src/lib/redact-execution.js';

/**
 * Secret-leak regression suite (plan dt-r1-03): execution IO contains runtime
 * values (HTTP responses, decrypted credentials) that redactWorkflow never
 * covered. These tests prove secrets do not survive into `execution logs`,
 * `--capture` files, or verify artifacts by default.
 */
describe('redactExecutionData', () => {
  it('redacts secret-named keys at any depth (case-insensitive)', () => {
    const out = redactExecutionData({
      headers: { Authorization: 'Bearer abc123xyz', 'x-n8n-api-key': 'k' },
      nested: { Password: 'hunter2', client_secret: 's', apiKey: 'a' },
      ok: 'visible',
    });
    expect(out.headers.Authorization).toBe('[REDACTED]');
    expect(out.headers['x-n8n-api-key']).toBe('[REDACTED]');
    expect(out.nested.Password).toBe('[REDACTED]');
    expect(out.nested.client_secret).toBe('[REDACTED]');
    expect(out.nested.apiKey).toBe('[REDACTED]');
    expect(out.ok).toBe('visible');
  });

  it('redacts secret-shaped VALUES inside ordinary string fields', () => {
    const out = redactExecutionData({
      log: 'calling with Bearer sk-proj-aaaaaaaaaaaaaaaaaaaa done',
      jwt: 'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig rest',
      github: 'pushed with ghp_0123456789abcdefghijklmnopqrstu ok',
      plain: 'nothing secret here',
    });
    expect(out.log).not.toContain('sk-proj-');
    expect(out.jwt).not.toContain('eyJhbGciOi');
    expect(out.github).not.toContain('ghp_');
    expect(out.plain).toBe('nothing secret here');
  });

  it('walks arrays and preserves non-secret structure exactly', () => {
    const input = {
      items: [
        { json: { title: 'A', token: 'tk' } },
        { json: { title: 'B', count: 2 } },
      ],
    };
    const out = redactExecutionData(input);
    expect(out.items[0].json.title).toBe('A');
    expect(out.items[0].json.token).toBe('[REDACTED]');
    expect(out.items[1].json).toEqual({ title: 'B', count: 2 });
  });

  it('does not mutate the input object', () => {
    const input = { password: 'p', a: { token: 't' } };
    redactExecutionData(input);
    expect(input.password).toBe('p');
    expect(input.a.token).toBe('t');
  });

  it('handles primitives, null, and undefined safely', () => {
    expect(redactExecutionData(null)).toBeNull();
    expect(redactExecutionData(42)).toBe(42);
    expect(redactExecutionData('Bearer abcdef123456')).toContain('[REDACTED]');
  });
});
