import { describe, it, expect } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import {
  assertCredentialPayload,
  validateAgainstSchema,
} from '../src/commands/credential/create.js';
import { ValidationError } from '../src/lib/errors.js';
import { N8nClient, type ClientEvent } from '../src/lib/api.js';
import type { ResolvedAuth } from '../src/lib/auth.js';

describe('assertCredentialPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(() =>
      assertCredentialPayload({
        name: 'My API Cred',
        type: 'httpHeaderAuth',
        data: { name: 'X-API-KEY', value: 'secret' },
      }),
    ).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => assertCredentialPayload(null)).toThrow(ValidationError);
  });

  it('rejects array', () => {
    expect(() => assertCredentialPayload([])).toThrow(ValidationError);
  });

  it('rejects missing name', () => {
    expect(() =>
      assertCredentialPayload({ type: 'x', data: {} }),
    ).toThrow(/name/);
  });

  it('rejects empty name', () => {
    expect(() =>
      assertCredentialPayload({ name: '   ', type: 'x', data: {} }),
    ).toThrow(/name/);
  });

  it('rejects missing type', () => {
    expect(() =>
      assertCredentialPayload({ name: 'x', data: {} }),
    ).toThrow(/type/);
  });

  it('rejects non-object data', () => {
    expect(() =>
      assertCredentialPayload({ name: 'x', type: 'y', data: 'oops' }),
    ).toThrow(/data/);
  });

  it('rejects array data', () => {
    expect(() =>
      assertCredentialPayload({ name: 'x', type: 'y', data: [] }),
    ).toThrow(/data/);
  });

  it('rejects null data', () => {
    expect(() =>
      assertCredentialPayload({ name: 'x', type: 'y', data: null }),
    ).toThrow(/data/);
  });
});

describe('validateAgainstSchema', () => {
  const httpHeaderSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['name', 'value'],
  };

  it('passes when all required fields present', () => {
    expect(() =>
      validateAgainstSchema(
        { name: 'X-API-KEY', value: 'secret' },
        httpHeaderSchema,
        'httpHeaderAuth',
      ),
    ).not.toThrow();
  });

  it('throws ValidationError listing missing required fields', () => {
    expect(() =>
      validateAgainstSchema({ name: 'X-API-KEY' }, httpHeaderSchema, 'httpHeaderAuth'),
    ).toThrow(/value/);
  });

  it('throws when required field is null', () => {
    expect(() =>
      validateAgainstSchema(
        { name: 'X-API-KEY', value: null },
        httpHeaderSchema,
        'httpHeaderAuth',
      ),
    ).toThrow(/value/);
  });

  it('throws when required field is undefined', () => {
    expect(() =>
      validateAgainstSchema(
        { name: 'X-API-KEY', value: undefined },
        httpHeaderSchema,
        'httpHeaderAuth',
      ),
    ).toThrow(/value/);
  });

  it('hint mentions schema command + escape hatch', () => {
    try {
      validateAgainstSchema({}, httpHeaderSchema, 'httpHeaderAuth');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).hint).toMatch(/credential schema httpHeaderAuth/);
      expect((err as ValidationError).hint).toMatch(/--no-validate/);
    }
  });

  it('lists multiple missing fields together', () => {
    try {
      validateAgainstSchema({}, httpHeaderSchema, 'httpHeaderAuth');
    } catch (err) {
      expect((err as Error).message).toMatch(/name/);
      expect((err as Error).message).toMatch(/value/);
    }
  });

  it('passes when schema has no required fields', () => {
    expect(() =>
      validateAgainstSchema({}, { type: 'object', properties: {} }, 'someType'),
    ).not.toThrow();
  });

  it('passes when schema lacks required array entirely', () => {
    expect(() => validateAgainstSchema({ a: 1 }, {}, 'someType')).not.toThrow();
  });

  it('accepts extra fields not in schema (forward-compat)', () => {
    expect(() =>
      validateAgainstSchema(
        { name: 'X', value: 'Y', extra: 'allowed' },
        httpHeaderSchema,
        'httpHeaderAuth',
      ),
    ).not.toThrow();
  });
});

describe('credential create — NDJSON event safety', () => {
  it('http client lifecycle events never include the request body (secret data)', async () => {
    const auth: ResolvedAuth = {
      host: 'https://test.example.com',
      apiKey: 'test-key',
      profileName: 'test',
      source: 'flag',
    };
    const events: ClientEvent[] = [];
    const client = new N8nClient(auth, {
      baseBackoffMs: 1,
      onEvent: (e) => events.push(e),
    });
    const mock = new MockAdapter((client as unknown as { http: axios.AxiosInstance }).http);
    mock.onPost('/credentials').reply(201, {
      id: 'cred-1',
      name: 'My Cred',
      type: 'httpHeaderAuth',
    });

    const SECRET_VALUE = 'super-secret-bearer-token-xyz';
    await client.post('/credentials', {
      name: 'My Cred',
      type: 'httpHeaderAuth',
      data: { name: 'X-API-KEY', value: SECRET_VALUE },
    });

    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      const serialized = JSON.stringify(ev);
      expect(
        serialized,
        `event "${ev.event}" leaked secret payload: ${serialized}`,
      ).not.toContain(SECRET_VALUE);
    }
  });
});
