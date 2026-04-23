import { describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { N8nClient } from '../src/lib/api.js';
import { ApiError, NetworkError } from '../src/lib/errors.js';
import type { ResolvedAuth } from '../src/lib/auth.js';

const TEST_AUTH: ResolvedAuth = {
  host: 'https://test.example.com',
  apiKey: 'test-key',
  profileName: 'test',
  source: 'flag',
};

/**
 * Helper: create client with mock adapters on both internal axios instances.
 * Uses 1ms backoff so retry tests don't sleep seconds.
 */
function createClientWithMocks(): {
  client: N8nClient;
  apiMock: MockAdapter;
  webhookMock: MockAdapter;
} {
  const client = new N8nClient(TEST_AUTH, { baseBackoffMs: 1, timeout: 1000 });
  // Private fields accessed via cast — test-only
  const apiMock = new MockAdapter((client as unknown as { http: axios.AxiosInstance }).http);
  const webhookMock = new MockAdapter(
    (client as unknown as { webhookHttp: axios.AxiosInstance }).webhookHttp,
  );
  return { client, apiMock, webhookMock };
}

describe('N8nClient.request — success path', () => {
  let env: ReturnType<typeof createClientWithMocks>;
  beforeEach(() => {
    env = createClientWithMocks();
  });

  it('returns body on 200', async () => {
    env.apiMock.onGet('/workflows').reply(200, { data: [{ id: '1' }] });
    const r = await env.client.get<{ data: unknown[] }>('/workflows');
    expect(r.data).toHaveLength(1);
  });

  it('returns body on 201', async () => {
    env.apiMock.onPost('/tags').reply(201, { id: 'abc', name: 'x' });
    const r = await env.client.post<{ id: string }>('/tags', { name: 'x' });
    expect(r.id).toBe('abc');
  });

  it('attaches X-N8N-API-KEY header on API calls', async () => {
    env.apiMock.onGet('/workflows').reply((config) => {
      expect(config.headers?.['X-N8N-API-KEY']).toBe('test-key');
      return [200, {}];
    });
    await env.client.get('/workflows');
  });
});

describe('N8nClient.request — retry on transient status', () => {
  let env: ReturnType<typeof createClientWithMocks>;
  beforeEach(() => {
    env = createClientWithMocks();
  });

  it('retries on 429 and succeeds', async () => {
    let calls = 0;
    env.apiMock.onGet('/workflows').reply(() => {
      calls++;
      return calls < 3 ? [429, { error: 'rate limited' }] : [200, { ok: true }];
    });
    const r = await env.client.get<{ ok: boolean }>('/workflows');
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('retries on 503 and succeeds', async () => {
    let calls = 0;
    env.apiMock.onGet('/x').reply(() => {
      calls++;
      return calls < 2 ? [503, ''] : [200, { ok: 1 }];
    });
    await env.client.get('/x');
    expect(calls).toBe(2);
  });

  it('retries on 502, 504 exhaustively then throws ApiError', async () => {
    env.apiMock.onGet('/x').reply(502);
    await expect(env.client.get('/x')).rejects.toThrow(ApiError);
    // N8nClient default maxRetries=3 → 4 total attempts
    expect(env.apiMock.history.get.length).toBe(4);
  });

  it('respects Retry-After header (seconds as number)', async () => {
    let first = true;
    const start = Date.now();
    env.apiMock.onGet('/x').reply(() => {
      if (first) {
        first = false;
        return [429, '', { 'retry-after': '1' }];
      }
      return [200, {}];
    });
    await env.client.get('/x');
    const elapsed = Date.now() - start;
    // Should wait ~1000ms due to Retry-After, not the 1ms exponential
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('respects Retry-After with HTTP date', async () => {
    let first = true;
    // UTCString rounds to whole seconds; use 2000ms buffer so the parsed
    // date is still reliably in the future when parseRetryAfter runs.
    const futureDate = new Date(Date.now() + 2000).toUTCString();
    env.apiMock.onGet('/x').reply(() => {
      if (first) {
        first = false;
        return [503, '', { 'retry-after': futureDate }];
      }
      return [200, {}];
    });
    const start = Date.now();
    await env.client.get('/x');
    const elapsed = Date.now() - start;
    // Should wait at least ~1000ms (the date-based delay) before retry.
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });
});

describe('N8nClient.request — non-retryable errors', () => {
  let env: ReturnType<typeof createClientWithMocks>;
  beforeEach(() => {
    env = createClientWithMocks();
  });

  it('throws ApiError on 401 without retrying', async () => {
    env.apiMock.onGet('/x').reply(401, { error: 'bad key' });
    await expect(env.client.get('/x')).rejects.toThrow(ApiError);
    expect(env.apiMock.history.get.length).toBe(1);
  });

  it('ApiError on 404 carries status + hint', async () => {
    env.apiMock.onGet('/workflows/missing').reply(404, { message: 'not found' });
    try {
      await env.client.get('/workflows/missing');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).hint).toBeDefined();
    }
  });

  it('ApiError on 403 hints at permissions', async () => {
    env.apiMock.onGet('/x').reply(403);
    try {
      await env.client.get('/x');
    } catch (err) {
      expect((err as ApiError).hint).toMatch(/permission/i);
    }
  });

  it('ApiError on 500+ hints at server error', async () => {
    env.apiMock.onGet('/x').reply(500);
    // 500 is not retryable in our policy, but 502/503/504 are; 500 falls through
    try {
      await env.client.get('/x');
    } catch (err) {
      expect((err as ApiError).hint).toMatch(/server/i);
    }
  });
});

describe('N8nClient.request — network errors', () => {
  let env: ReturnType<typeof createClientWithMocks>;
  beforeEach(() => {
    env = createClientWithMocks();
  });

  it('retries on ECONNRESET and succeeds', async () => {
    let calls = 0;
    env.apiMock.onGet('/x').reply(() => {
      calls++;
      if (calls < 2) {
        const err = new axios.AxiosError('connection reset');
        err.code = 'ECONNRESET';
        return Promise.reject(err);
      }
      return [200, { ok: true }];
    });
    await env.client.get('/x');
    expect(calls).toBe(2);
  });

  it('throws NetworkError after exhausting retries on network err', async () => {
    env.apiMock.onGet('/x').reply(() => {
      const err = new axios.AxiosError('ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      return Promise.reject(err);
    });
    await expect(env.client.get('/x')).rejects.toThrow(NetworkError);
  });

  it('does NOT retry on non-network axios error', async () => {
    env.apiMock.onGet('/x').reply(() => {
      const err = new axios.AxiosError('unknown');
      err.code = 'EOTHER';
      return Promise.reject(err);
    });
    await expect(env.client.get('/x')).rejects.toThrow(NetworkError);
    expect(env.apiMock.history.get.length).toBe(1);
  });
});

describe('N8nClient.paginate', () => {
  let env: ReturnType<typeof createClientWithMocks>;
  beforeEach(() => {
    env = createClientWithMocks();
  });

  it('yields items across multiple pages', async () => {
    env.apiMock
      .onGet('/workflows', { params: {} })
      .replyOnce(200, { data: [{ id: '1' }, { id: '2' }], nextCursor: 'page2' });
    env.apiMock
      .onGet('/workflows', { params: { cursor: 'page2' } })
      .replyOnce(200, { data: [{ id: '3' }], nextCursor: null });

    const items: Array<{ id: string }> = [];
    for await (const item of env.client.paginate<{ id: string }>('/workflows')) {
      items.push(item);
    }
    expect(items.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('yields empty when no data', async () => {
    env.apiMock.onGet('/workflows').reply(200, { data: [], nextCursor: null });
    const items: unknown[] = [];
    for await (const item of env.client.paginate('/workflows')) {
      items.push(item);
    }
    expect(items).toHaveLength(0);
  });

  it('passes extra params alongside cursor', async () => {
    env.apiMock
      .onGet('/workflows')
      .reply((config) => {
        expect(config.params.active).toBe(true);
        return [200, { data: [], nextCursor: null }];
      });
    const gen = env.client.paginate('/workflows', { active: true });
    await gen.next();
  });
});

describe('N8nClient.webhookRequest', () => {
  let env: ReturnType<typeof createClientWithMocks>;
  beforeEach(() => {
    env = createClientWithMocks();
  });

  it('does NOT attach X-N8N-API-KEY header', async () => {
    env.webhookMock.onPost('https://hook/x').reply((config) => {
      expect(config.headers?.['X-N8N-API-KEY']).toBeUndefined();
      return [200, {}];
    });
    await env.client.webhookRequest('https://hook/x', {});
  });

  it('passes custom auth headers', async () => {
    env.webhookMock.onPost('https://hook/x').reply((config) => {
      expect(config.headers?.['Authorization']).toBe('Bearer token-123');
      return [200, {}];
    });
    await env.client.webhookRequest('https://hook/x', {}, {
      headers: { Authorization: 'Bearer token-123' },
    });
  });

  it('retries on 502 like API requests', async () => {
    let calls = 0;
    env.webhookMock.onPost('https://hook/x').reply(() => {
      calls++;
      return calls < 2 ? [502, ''] : [200, { ok: 1 }];
    });
    await env.client.webhookRequest('https://hook/x', {});
    expect(calls).toBe(2);
  });

  it('uses GET method when specified', async () => {
    env.webhookMock.onGet('https://hook/x').reply(200, { ok: 1 });
    const r = await env.client.webhookRequest('https://hook/x', null, { method: 'GET' });
    expect(r).toBeDefined();
  });

  it('error message prefixed with "webhook" label', async () => {
    env.webhookMock.onPost('https://hook/x').reply(404);
    try {
      await env.client.webhookRequest('https://hook/x', {});
    } catch (err) {
      expect((err as Error).message).toMatch(/webhook/);
    }
  });
});

describe('N8nClient — insecure option', () => {
  it('still hits API with insecure:true (doesn\'t break construction)', async () => {
    const client = new N8nClient(TEST_AUTH, { insecure: true, baseBackoffMs: 1 });
    const mock = new MockAdapter((client as unknown as { http: axios.AxiosInstance }).http);
    mock.onGet('/x').reply(200, {});
    await expect(client.get('/x')).resolves.toEqual({});
  });
});
