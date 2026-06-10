import { describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { N8nSessionClient, pickTrigger, isTriggerNode } from '../src/lib/session-api.js';
import { ApiError, AuthError } from '../src/lib/errors.js';
import type { ResolvedSession } from '../src/lib/auth.js';

const SESSION: ResolvedSession = {
  host: 'https://test.example.com',
  email: 'a@b.com',
  password: 'pw',
  profileName: 'test',
};

function make(session: Partial<ResolvedSession> = {}): { client: N8nSessionClient; mock: MockAdapter; cookies: string[] } {
  const cookies: string[] = [];
  const client = new N8nSessionClient(
    { ...SESSION, ...session },
    { onCookie: (c) => { cookies.push(c); } },
  );
  const mock = new MockAdapter((client as unknown as { http: axios.AxiosInstance }).http);
  return { client, mock, cookies };
}

describe('isTriggerNode / pickTrigger', () => {
  it('detects trigger nodes', () => {
    expect(isTriggerNode({ type: 'n8n-nodes-base.manualTrigger' })).toBe(true);
    expect(isTriggerNode({ type: 'n8n-nodes-base.scheduleTrigger' })).toBe(true);
    expect(isTriggerNode({ type: 'n8n-nodes-base.webhook' })).toBe(true);
    expect(isTriggerNode({ type: 'n8n-nodes-base.set' })).toBe(false);
  });

  it('returns undefined when no triggers', () => {
    expect(pickTrigger({ nodes: [{ name: 'Set', type: 'n8n-nodes-base.set' }] })).toBeUndefined();
  });

  it('returns the single trigger name', () => {
    expect(pickTrigger({ nodes: [{ name: 'Manual', type: 'n8n-nodes-base.manualTrigger' }] })).toBe('Manual');
  });

  it('prefers a NON-webhook trigger when multiple exist', () => {
    const name = pickTrigger({
      nodes: [
        { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger' },
      ],
    });
    expect(name).toBe('Schedule');
  });

  it('skips disabled triggers', () => {
    const name = pickTrigger({
      nodes: [
        { name: 'Manual', type: 'n8n-nodes-base.manualTrigger', disabled: true },
        { name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger' },
      ],
    });
    expect(name).toBe('Schedule');
  });
});

describe('N8nSessionClient.login', () => {
  let env: ReturnType<typeof make>;
  beforeEach(() => { env = make(); });

  it('captures cookie from set-cookie and persists via onCookie', async () => {
    env.mock.onPost('/login').reply(200, { data: { email: 'a@b.com' } }, {
      'set-cookie': ['n8n-auth=tok123; Path=/; HttpOnly'],
    });
    await env.client.login();
    expect(env.cookies).toHaveLength(1);
    expect(env.cookies[0]).toContain('n8n-auth=tok123');
  });

  it('attaches Cookie header on subsequent requests, NOT X-N8N-API-KEY', async () => {
    env.mock.onPost('/login').reply(200, { data: {} }, { 'set-cookie': ['n8n-auth=tok'] });
    await env.client.login();
    env.mock.onGet('/login').reply((config) => {
      expect(config.headers?.Cookie).toContain('n8n-auth=tok');
      expect(config.headers?.['X-N8N-API-KEY']).toBeUndefined();
      return [200, { data: { email: 'a@b.com' } }];
    });
    await env.client.whoami();
  });

  it('throws AuthError on 401 login (bad creds)', async () => {
    env.mock.onPost('/login').reply(401, { message: 'unauthorized' });
    await expect(env.client.login()).rejects.toThrow(AuthError);
  });

  it('throws AuthError when no cookie present and no password (cookie-only expired)', async () => {
    const c = make({ password: undefined, cookieOnly: true }).client;
    await expect(c.login()).rejects.toThrow(/cookie-only|password/i);
  });
});

describe('N8nSessionClient 401 → re-login', () => {
  it('re-logs in once on 401 then retries the request', async () => {
    const env = make({ cookie: 'n8n-auth=stale' });
    let logins = 0;
    env.mock.onPost('/login').reply(() => { logins++; return [200, { data: {} }, { 'set-cookie': ['n8n-auth=fresh'] }]; });
    let calls = 0;
    env.mock.onGet('/workflows/1').reply(() => {
      calls++;
      return calls === 1 ? [401, { message: 'expired' }] : [200, { data: { id: '1', name: 'W' } }];
    });
    const wf = await env.client.getWorkflowRest('1');
    expect(wf.name).toBe('W');
    expect(logins).toBe(1);
  });

  it('does NOT loop infinitely if 401 persists (second 401 throws)', async () => {
    const env = make({ cookie: 'n8n-auth=stale' });
    env.mock.onPost('/login').reply(200, { data: {} }, { 'set-cookie': ['n8n-auth=fresh'] });
    env.mock.onGet('/workflows/1').reply(401, { message: 'still expired' });
    await expect(env.client.getWorkflowRest('1')).rejects.toThrow(ApiError);
  });

  it('concurrent 401s trigger a SINGLE re-login (single-flight)', async () => {
    const env = make({ cookie: 'n8n-auth=stale' });
    let logins = 0;
    env.mock.onPost('/login').reply(async () => {
      logins++;
      await new Promise((r) => setTimeout(r, 20));
      return [200, { data: {} }, { 'set-cookie': ['n8n-auth=fresh'] }];
    });
    const seen: Record<string, number> = {};
    env.mock.onGet(/\/workflows\/.*/).reply((config) => {
      const url = config.url ?? '';
      seen[url] = (seen[url] ?? 0) + 1;
      return seen[url] === 1 ? [401, {}] : [200, { data: { id: url, name: 'W' } }];
    });
    await Promise.all([
      env.client.getWorkflowRest('a'),
      env.client.getWorkflowRest('b'),
      env.client.getWorkflowRest('c'),
    ]);
    expect(logins).toBe(1); // not 3
  });
});

describe('N8nSessionClient.runWorkflow', () => {
  let env: ReturnType<typeof make>;
  beforeEach(() => { env = make({ cookie: 'n8n-auth=tok' }); });

  it('picks a trigger, posts {workflowData, triggerToStartFrom}, returns executionId', async () => {
    env.mock.onGet('/workflows/1').reply(200, {
      data: { id: '1', name: 'W', nodes: [{ name: 'Manual', type: 'n8n-nodes-base.manualTrigger' }], connections: {} },
    });
    env.mock.onPost('/workflows/1/run').reply((config) => {
      const body = JSON.parse(config.data as string);
      expect(body.workflowData).toBeDefined();
      expect(body.triggerToStartFrom).toEqual({ name: 'Manual' });
      expect(body.runData).toBeUndefined(); // never send runData (Partial-variant pitfall)
      return [200, { data: { executionId: 999 } }];
    });
    const r = await env.client.runWorkflow('1');
    expect(r.executionId).toBe('999');
  });

  it('honors an explicit --trigger name', async () => {
    env.mock.onGet('/workflows/1').reply(200, {
      data: { id: '1', name: 'W', nodes: [
        { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger' },
      ], connections: {} },
    });
    env.mock.onPost('/workflows/1/run').reply((config) => {
      const body = JSON.parse(config.data as string);
      expect(body.triggerToStartFrom).toEqual({ name: 'Cron' });
      return [200, { data: { executionId: 1 } }];
    });
    await env.client.runWorkflow('1', 'Cron');
  });

  it('throws with a helpful hint on waitingForWebhook', async () => {
    env.mock.onGet('/workflows/1').reply(200, {
      data: { id: '1', name: 'W', nodes: [{ name: 'Webhook', type: 'n8n-nodes-base.webhook' }], connections: {} },
    });
    env.mock.onPost('/workflows/1/run').reply(200, { data: { waitingForWebhook: true } });
    await expect(env.client.runWorkflow('1')).rejects.toThrow(/webhook/i);
  });

  it('throws when no executionId returned', async () => {
    env.mock.onGet('/workflows/1').reply(200, { data: { id: '1', name: 'W', nodes: [], connections: {} } });
    env.mock.onPost('/workflows/1/run').reply(200, { data: {} });
    await expect(env.client.runWorkflow('1')).rejects.toThrow(/executionId/);
  });
});

describe('N8nSessionClient.waitExecution', () => {
  it('polls /rest/executions until terminal status', async () => {
    const env = make({ cookie: 'n8n-auth=tok' });
    let n = 0;
    env.mock.onGet('/executions/5').reply(() => {
      n++;
      return n < 2 ? [200, { data: { id: '5', status: 'running', finished: false } }]
                   : [200, { data: { id: '5', status: 'success', finished: true } }];
    });
    const e = await env.client.waitExecution('5', { timeoutMs: 5000, pollMs: 5 });
    expect(e.status).toBe('success');
  });

  it('throws on timeout', async () => {
    const env = make({ cookie: 'n8n-auth=tok' });
    env.mock.onGet('/executions/5').reply(200, { data: { id: '5', status: 'running', finished: false } });
    await expect(env.client.waitExecution('5', { timeoutMs: 30, pollMs: 5 })).rejects.toThrow(/Timeout/);
  });
});
