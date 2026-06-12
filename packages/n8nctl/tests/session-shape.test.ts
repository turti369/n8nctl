import { describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { N8nSessionClient } from '../src/lib/session-api.js';
import { ApiError } from '../src/lib/errors.js';
import type { ResolvedSession } from '../src/lib/auth.js';

const SESSION: ResolvedSession = {
  host: 'https://test.example.com',
  email: 'a@b.com',
  password: 'pw',
  profileName: 'test',
};

function make(): { client: N8nSessionClient; mock: MockAdapter } {
  const client = new N8nSessionClient(SESSION, {});
  const mock = new MockAdapter((client as unknown as { http: axios.AxiosInstance }).http);
  mock.onPost('/login').reply(200, { data: { email: 'a@b.com' } }, {
    'set-cookie': ['n8n-auth=tok123; Path=/; HttpOnly'],
  });
  return { client, mock };
}

/**
 * /rest is internal + unversioned: some n8n versions wrap responses in
 * { data }, others return the object bare. Regression for the v0.6.0 shape
 * guards replacing the silent `(r.data ?? r) as T` double-cast.
 */
describe('session client /rest response shape guards', () => {
  let env: ReturnType<typeof make>;
  beforeEach(() => {
    env = make();
  });

  it('accepts a { data: workflow } envelope', async () => {
    env.mock.onGet('/workflows/1').reply(200, { data: { id: '1', name: 'wf', nodes: [] } });
    const wf = await env.client.getWorkflowRest('1');
    expect(wf.name).toBe('wf');
  });

  it('accepts a bare workflow object (no envelope)', async () => {
    env.mock.onGet('/workflows/1').reply(200, { id: '1', name: 'wf', nodes: [] });
    const wf = await env.client.getWorkflowRest('1');
    expect(wf.name).toBe('wf');
  });

  it('throws ApiError on a non-object workflow response instead of silently casting', async () => {
    env.mock.onGet('/workflows/1').reply(200, '"unexpected string"');
    await expect(env.client.getWorkflowRest('1')).rejects.toThrow(ApiError);
  });

  it('throws ApiError on a non-object execution response', async () => {
    env.mock.onGet('/executions/9').reply(200, '42');
    await expect(env.client.getExecution('9')).rejects.toThrow(ApiError);
  });
});
