import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeFakeFactory, type FakeFactory } from './helpers/fake-factory.js';
import { createWorkflowHandler } from '../src/commands/workflow/create.js';
import { activateHandler } from '../src/commands/workflow/activate.js';
import { refreshHandler } from '../src/commands/workflow/refresh.js';
import { tagHandler } from '../src/commands/workflow/tag.js';
import { runHandler } from '../src/commands/workflow/run.js';
import { ApiError } from '../src/lib/errors.js';

const MINIMAL_WF = JSON.stringify({
  name: 'wf',
  nodes: [{ name: 'Manual', type: 'n8n-nodes-base.manualTrigger', parameters: {}, position: [0, 0] }],
  connections: {},
});

describe('createWorkflowHandler', () => {
  let env: FakeFactory;
  let exitCode: number | undefined;
  beforeEach(() => {
    exitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = exitCode;
  });

  it('POSTs a normalized workflow and prints the result', async () => {
    env = makeFakeFactory({ json: true });
    let body: unknown;
    env.apiMock.onPost('/workflows').reply((cfg) => {
      body = JSON.parse(cfg.data as string);
      return [200, { id: 'w1', name: 'wf', active: false }];
    });
    // feed JSON via a data: not stdin — write to a temp file
    const { writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const f = join(tmpdir(), `n8nctl-test-${Date.now()}.json`);
    writeFileSync(f, MINIMAL_WF);
    try {
      await createWorkflowHandler(env.factory, {}, [f]);
    } finally {
      rmSync(f, { force: true });
    }
    expect((body as { name: string }).name).toBe('wf');
    expect(env.stdout()).toContain('"id": "w1"');
    // normalize ran (deterministic node id injected)
    expect(env.events.some((e) => e.event === 'workflow-normalized')).toBe(true);
  });
});

describe('activateHandler', () => {
  it('POSTs activate and reports success', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPost('/workflows/42/activate').reply(200, { id: '42', name: 'wf', active: true });
    await activateHandler(env.factory, {}, ['42']);
    expect(env.stdout()).toContain('activated workflow');
    expect(env.stdout()).toContain('42');
  });
});

describe('refreshHandler', () => {
  let saved: number | undefined;
  beforeEach(() => {
    saved = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = saved;
  });

  it('sets exitCode 1 (not process.exit) when workflow is inactive', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/7').reply(200, { id: '7', name: 'wf', active: false });
    await refreshHandler(env.factory, {}, ['7']);
    expect(process.exitCode).toBe(1);
    expect(env.stderr()).toContain('inactive');
  });

  it('cycles deactivate → activate when active', async () => {
    const env = makeFakeFactory({ logFormat: 'text' });
    env.apiMock.onGet('/workflows/7').reply(200, { id: '7', name: 'wf', active: true });
    env.apiMock.onPost('/workflows/7/deactivate').reply(200, { active: false });
    env.apiMock.onPost('/workflows/7/activate').reply(200, { id: '7', name: 'wf', active: true });
    await refreshHandler(env.factory, { delay: 0 }, ['7']);
    expect(env.stdout()).toContain('cycled');
    expect(process.exitCode).toBeUndefined();
  });

  it('dry-run does not call deactivate/activate', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/workflows/7').reply(200, { id: '7', name: 'wf', active: true });
    let mutated = false;
    env.apiMock.onPost(/\/workflows\/7\/(de)?activate/).reply(() => {
      mutated = true;
      return [200, {}];
    });
    await refreshHandler(env.factory, {}, ['7']);
    expect(mutated).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
  });
});

describe('tagHandler', () => {
  it('throws ApiError when a tag is missing and --create not passed', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/tags').reply(200, { data: [{ id: 't1', name: 'prod' }] });
    await expect(tagHandler(env.factory, {}, ['9', 'nonexistent'])).rejects.toThrow(ApiError);
  });

  it('appends an existing tag via PUT (merges with current)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/tags').reply(200, { data: [{ id: 't1', name: 'prod' }] });
    env.apiMock.onGet('/workflows/9/tags').reply(200, [{ id: 't0', name: 'old' }]);
    let putBody: unknown;
    env.apiMock.onPut('/workflows/9/tags').reply((cfg) => {
      putBody = JSON.parse(cfg.data as string);
      return [200, []];
    });
    await tagHandler(env.factory, {}, ['9', 'prod']);
    expect(putBody).toEqual(expect.arrayContaining([{ id: 't0' }, { id: 't1' }]));
    expect(env.stdout()).toContain('tagged');
  });

  it('dry-run with --create does not POST a new tag', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/tags').reply(200, { data: [] });
    env.apiMock.onGet('/workflows/9/tags').reply(200, []);
    let created = false;
    env.apiMock.onPost('/tags').reply(() => {
      created = true;
      return [200, { id: 'x', name: 'new' }];
    });
    await tagHandler(env.factory, { create: true }, ['9', 'new']);
    expect(created).toBe(false);
    expect(env.stderr()).toContain('[dry-run] would create tag');
  });
});

describe('runHandler', () => {
  let saved: number | undefined;
  beforeEach(() => {
    saved = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = saved;
  });

  it('dry-run does not hit the session client', async () => {
    const env = makeFakeFactory({ dryRun: true });
    await runHandler(env.factory, {}, ['5']);
    expect(env.stdout()).toContain('[dry-run]');
  });

  it('starts an execution and emits the started event (no --wait)', async () => {
    const env = makeFakeFactory({ logFormat: 'ndjson' });
    const sm = env.sessionMock();
    sm.onGet('/workflows/5').reply(200, {
      data: { id: '5', name: 'wf', nodes: [{ name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger' }] },
    });
    sm.onPost('/workflows/5/run').reply(200, { data: { executionId: 'e9' } });
    await runHandler(env.factory, {}, ['5']);
    expect(env.events.some((e) => e.event === 'workflow-run-started')).toBe(true);
    expect(env.stderr()).toContain('workflow-run-started');
  });

  it('sets exitCode 1 when --wait sees a non-success terminal status', async () => {
    const env = makeFakeFactory();
    const sm = env.sessionMock();
    sm.onGet('/workflows/5').reply(200, {
      data: { id: '5', name: 'wf', nodes: [{ name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger' }] },
    });
    sm.onPost('/workflows/5/run').reply(200, { data: { executionId: 'e9' } });
    sm.onGet('/executions/e9').reply(200, { data: { id: 'e9', status: 'error', finished: true } });
    await runHandler(env.factory, { wait: true, timeout: 5000 }, ['5']);
    expect(process.exitCode).toBe(1);
  });
});
