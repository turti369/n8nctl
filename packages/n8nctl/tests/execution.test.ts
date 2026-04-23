import { describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { N8nClient } from '../src/lib/api.js';
import { waitForExecution, getLastError } from '../src/lib/execution.js';
import type { ResolvedAuth } from '../src/lib/auth.js';

const TEST_AUTH: ResolvedAuth = {
  host: 'https://test.example.com',
  apiKey: 'k',
  profileName: 't',
  source: 'flag',
};

function makeClient() {
  const client = new N8nClient(TEST_AUTH, { baseBackoffMs: 1, timeout: 500 });
  const mock = new MockAdapter((client as unknown as { http: axios.AxiosInstance }).http);
  return { client, mock };
}

describe('waitForExecution — by executionId', () => {
  let env: ReturnType<typeof makeClient>;
  beforeEach(() => {
    env = makeClient();
  });

  it('returns execution when already finished (first poll)', async () => {
    env.mock
      .onGet('/executions/exec-1')
      .reply(200, { id: 'exec-1', finished: true, status: 'success' });
    const r = await waitForExecution(env.client, {
      executionId: 'exec-1',
      timeoutMs: 5000,
    });
    expect(r.status).toBe('success');
  });

  it('polls until terminal (running → success)', async () => {
    let calls = 0;
    env.mock.onGet('/executions/exec-1').reply(() => {
      calls++;
      if (calls < 3) return [200, { id: 'exec-1', finished: false, status: 'running' }];
      return [200, { id: 'exec-1', finished: true, status: 'success' }];
    });
    const r = await waitForExecution(env.client, {
      executionId: 'exec-1',
      timeoutMs: 5000,
      pollIntervalMs: 10,
    });
    expect(r.status).toBe('success');
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('recognizes each terminal status', async () => {
    for (const status of ['success', 'error', 'canceled', 'crashed']) {
      env = makeClient();
      env.mock
        .onGet('/executions/e')
        .reply(200, { id: 'e', finished: true, status });
      const r = await waitForExecution(env.client, {
        executionId: 'e',
        timeoutMs: 1000,
        pollIntervalMs: 10,
      });
      expect(r.status).toBe(status);
    }
  });

  it('throws on timeout', async () => {
    env.mock
      .onGet('/executions/stuck')
      .reply(200, { id: 'stuck', finished: false, status: 'running' });
    await expect(
      waitForExecution(env.client, {
        executionId: 'stuck',
        timeoutMs: 50,
        pollIntervalMs: 10,
      }),
    ).rejects.toThrow(/Timeout/);
  });

  it('handles 404 during poll (execution not yet created)', async () => {
    let calls = 0;
    env.mock.onGet('/executions/late').reply(() => {
      calls++;
      if (calls < 2) return [404, { message: 'not found' }];
      return [200, { id: 'late', finished: true, status: 'success' }];
    });
    const r = await waitForExecution(env.client, {
      executionId: 'late',
      timeoutMs: 1000,
      pollIntervalMs: 10,
    });
    expect(r.status).toBe('success');
  });
});

describe('waitForExecution — by workflowId + since filter', () => {
  let env: ReturnType<typeof makeClient>;
  beforeEach(() => {
    env = makeClient();
  });

  it('picks newest execution after "since"', async () => {
    const since = new Date('2026-04-23T10:00:00Z');
    env.mock.onGet('/executions').reply(200, {
      data: [
        { id: '102', workflowId: 'w1', finished: true, status: 'success', startedAt: '2026-04-23T10:00:05Z' },
        { id: '101', workflowId: 'w1', finished: true, status: 'success', startedAt: '2026-04-23T09:59:00Z' },
      ],
    });
    const r = await waitForExecution(env.client, {
      workflowId: 'w1',
      since,
      timeoutMs: 5000,
      pollIntervalMs: 10,
    });
    expect(r.id).toBe('102');
  });

  it('waits when no execution matches "since" yet', async () => {
    let calls = 0;
    const since = new Date('2026-04-23T10:00:00Z');
    env.mock.onGet('/executions').reply(() => {
      calls++;
      if (calls < 2) {
        return [200, {
          data: [
            { id: '99', workflowId: 'w', startedAt: '2026-04-23T09:00:00Z', finished: true, status: 'success' },
          ],
        }];
      }
      return [200, {
        data: [
          { id: '100', workflowId: 'w', startedAt: '2026-04-23T10:00:30Z', finished: true, status: 'success' },
        ],
      }];
    });
    const r = await waitForExecution(env.client, {
      workflowId: 'w',
      since,
      timeoutMs: 5000,
      pollIntervalMs: 10,
    });
    expect(r.id).toBe('100');
  });

  it('returns null execution gracefully when data empty → eventually times out', async () => {
    env.mock.onGet('/executions').reply(200, { data: [] });
    await expect(
      waitForExecution(env.client, {
        workflowId: 'w',
        timeoutMs: 50,
        pollIntervalMs: 10,
      }),
    ).rejects.toThrow(/Timeout/);
  });
});

describe('getLastError', () => {
  let env: ReturnType<typeof makeClient>;
  beforeEach(() => {
    env = makeClient();
  });

  it('returns newest failed execution', async () => {
    env.mock.onGet('/executions').reply((config) => {
      expect(config.params).toMatchObject({ status: 'error', workflowId: 'w' });
      return [200, {
        data: [{ id: 'e1', status: 'error', finished: true, workflowId: 'w' }],
      }];
    });
    const r = await getLastError(env.client, 'w');
    expect(r?.id).toBe('e1');
  });

  it('returns null when no errors', async () => {
    env.mock.onGet('/executions').reply(200, { data: [] });
    const r = await getLastError(env.client, 'w');
    expect(r).toBeNull();
  });

  it('includes data in request params', async () => {
    env.mock.onGet('/executions').reply((config) => {
      expect(config.params.includeData).toBe(true);
      return [200, { data: [] }];
    });
    await getLastError(env.client, 'w');
  });
});
