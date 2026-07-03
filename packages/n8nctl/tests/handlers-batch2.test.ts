import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { getWorkflowHandler } from '../src/commands/workflow/get.js';
import { listWorkflowsHandler } from '../src/commands/workflow/list.js';
import { updateWorkflowHandler } from '../src/commands/workflow/update.js';
import { deactivateHandler } from '../src/commands/workflow/deactivate.js';
import { deleteWorkflowHandler } from '../src/commands/workflow/delete.js';
import { backupHandler } from '../src/commands/workflow/backup.js';
import { restoreHandler } from '../src/commands/workflow/restore.js';
import { diffHandler } from '../src/commands/workflow/diff.js';
import { validateHandler } from '../src/commands/workflow/validate.js';
import { normalizeHandler } from '../src/commands/workflow/normalize.js';
import { schemaHandler } from '../src/commands/workflow/schema.js';
import { statusHandler } from '../src/commands/workflow/status.js';
import { exportAllHandler } from '../src/commands/workflow/export-all.js';
import { importHandler } from '../src/commands/workflow/import.js';
import { triggerWebhookHandler } from '../src/commands/workflow/trigger-webhook.js';
import { getExecutionHandler } from '../src/commands/execution/get.js';
import { retryHandler } from '../src/commands/execution/retry.js';
import { lastErrorHandler } from '../src/commands/execution/last-error.js';
import { createTagHandler } from '../src/commands/tag/create.js';
import { listTagsHandler } from '../src/commands/tag/list.js';
import { credentialSchemaHandler } from '../src/commands/credential/schema.js';
import { configGetHandler } from '../src/commands/config/get.js';
import { configSetHandler } from '../src/commands/config/set.js';
import { doctorHandler } from '../src/commands/doctor.js';
import { ValidationError, ApiError } from '../src/lib/errors.js';

let tmpDir: string;
let savedExit: number | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-h2-'));
  savedExit = process.exitCode;
  process.exitCode = undefined;
});

afterEach(async () => {
  process.exitCode = savedExit;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const WF = {
  id: 'w1',
  name: 'My Flow',
  active: true,
  nodes: [
    {
      id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
      name: 'Manual',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
  ],
  connections: {},
};

describe('getWorkflowHandler', () => {
  it('prints JSON to stdout', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    await getWorkflowHandler(env.factory, {}, ['w1']);
    expect(env.stdout()).toContain('"name": "My Flow"');
  });

  it('writes to file with -o and reports on stderr', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    const out = path.join(tmpDir, 'wf.json');
    await getWorkflowHandler(env.factory, { output: out }, ['w1']);
    const saved = JSON.parse(await fs.readFile(out, 'utf8'));
    expect(saved.name).toBe('My Flow');
    expect(env.stderr()).toContain('saved workflow');
    expect(env.stdout()).toBe('');
  });
});

describe('listWorkflowsHandler', () => {
  it('applies --search as case-insensitive name filter', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/workflows').reply(200, {
      data: [WF, { ...WF, id: 'w2', name: 'Other' }],
    });
    await listWorkflowsHandler(env.factory, { search: 'my f' }, []);
    const printed = JSON.parse(env.stdout());
    expect(printed).toHaveLength(1);
    expect(printed[0].id).toBe('w1');
  });

  it('--all paginates across cursors', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/workflows').reply((cfg) => {
      const cursor = (cfg.params as Record<string, unknown>)?.cursor;
      if (cursor === 'next') return [200, { data: [{ ...WF, id: 'w2', name: 'B' }], nextCursor: null }];
      return [200, { data: [WF], nextCursor: 'next' }];
    });
    await listWorkflowsHandler(env.factory, { all: true }, []);
    expect(JSON.parse(env.stdout())).toHaveLength(2);
  });
});

describe('updateWorkflowHandler', () => {
  it('dry-run does not PUT', async () => {
    const env = makeFakeFactory({ dryRun: true });
    let put = false;
    env.apiMock.onPut('/workflows/w1').reply(() => {
      put = true;
      return [200, WF];
    });
    const f = path.join(tmpDir, 'wf.json');
    await fs.writeFile(f, JSON.stringify(WF));
    await updateWorkflowHandler(env.factory, {}, ['w1', f]);
    expect(put).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
  });

  it('strips read-only fields to the 4-field whitelist on PUT', async () => {
    const env = makeFakeFactory({ json: true });
    let body: Record<string, unknown> = {};
    env.apiMock.onPut('/workflows/w1').reply((cfg) => {
      body = JSON.parse(cfg.data as string);
      return [200, WF];
    });
    const f = path.join(tmpDir, 'wf.json');
    await fs.writeFile(
      f,
      JSON.stringify({ ...WF, pinData: { x: 1 }, staticData: {}, meta: {}, tags: [], triggerCount: 2 }),
    );
    await updateWorkflowHandler(env.factory, {}, ['w1', f]);
    expect(Object.keys(body).sort()).toEqual(['connections', 'name', 'nodes', 'settings']);
  });
});

describe('deactivate / delete', () => {
  it('deactivates and reports', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPost('/workflows/w1/deactivate').reply(200, WF);
    await deactivateHandler(env.factory, {}, ['w1']);
    expect(env.stdout()).toContain('deactivated workflow');
  });

  it('delete dry-run only GETs', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    let deleted = false;
    env.apiMock.onDelete('/workflows/w1').reply(() => {
      deleted = true;
      return [200, {}];
    });
    await deleteWorkflowHandler(env.factory, {}, ['w1']);
    expect(deleted).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
  });

  it('delete with --yes DELETEs', async () => {
    const env = makeFakeFactory();
    env.apiMock.onDelete('/workflows/w1').reply(200, {});
    await deleteWorkflowHandler(env.factory, { yes: true }, ['w1']);
    expect(env.stdout()).toContain('deleted workflow');
  });
});

describe('backup / restore / diff', () => {
  it('backup writes a timestamped file into -o dir', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    await backupHandler(env.factory, { output: tmpDir }, ['w1']);
    const files = await fs.readdir(tmpDir);
    expect(files.some((f) => f.startsWith('My_Flow_w1_') && f.endsWith('.json'))).toBe(true);
    expect(env.stdout()).toContain('backed up');
  });

  it('backup dry-run writes nothing', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    await backupHandler(env.factory, { output: tmpDir }, ['w1']);
    expect(await fs.readdir(tmpDir)).toHaveLength(0);
  });

  it('restore PUTs the file body to the file id', async () => {
    const env = makeFakeFactory();
    let put = false;
    env.apiMock.onPut('/workflows/w1').reply(() => {
      put = true;
      return [200, WF];
    });
    const f = path.join(tmpDir, 'backup.json');
    await fs.writeFile(f, JSON.stringify(WF));
    await restoreHandler(env.factory, {}, [f]);
    expect(put).toBe(true);
    expect(env.stdout()).toContain('restored workflow');
  });

  it('restore without id anywhere throws ValidationError', async () => {
    const env = makeFakeFactory();
    const f = path.join(tmpDir, 'noid.json');
    await fs.writeFile(f, JSON.stringify({ name: 'x', nodes: [], connections: {} }));
    await expect(restoreHandler(env.factory, {}, [f])).rejects.toThrow(ValidationError);
  });

  it('diff reports no differences for identical workflows', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    const f = path.join(tmpDir, 'local.json');
    await fs.writeFile(f, JSON.stringify(WF));
    await diffHandler(env.factory, {}, ['w1', f]);
    expect(env.stdout()).toContain('no differences');
  });

  it('diff lists a renamed workflow as modified', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    const f = path.join(tmpDir, 'local.json');
    await fs.writeFile(f, JSON.stringify({ ...WF, name: 'Renamed' }));
    await diffHandler(env.factory, {}, ['w1', f]);
    expect(env.stdout()).toContain('name');
    expect(env.stdout()).toContain('Renamed');
  });

  it('diff throws ValidationError on unparseable local file', async () => {
    const env = makeFakeFactory();
    const f = path.join(tmpDir, 'bad.json');
    await fs.writeFile(f, '{nope');
    await expect(diffHandler(env.factory, {}, ['w1', f])).rejects.toThrow(ValidationError);
  });
});

describe('validate / normalize / schema', () => {
  it('validate throws ValidationError on invalid JSON file', async () => {
    const env = makeFakeFactory();
    const f = path.join(tmpDir, 'bad.json');
    await fs.writeFile(f, '{broken');
    await expect(validateHandler(env.factory, {}, [f])).rejects.toThrow(ValidationError);
  });

  it('validate fails a structurally broken workflow', async () => {
    const env = makeFakeFactory();
    const f = path.join(tmpDir, 'broken.json');
    await fs.writeFile(f, JSON.stringify({ name: 'x' }));
    await expect(validateHandler(env.factory, {}, [f])).rejects.toThrow(ValidationError);
  });

  it('validate passes a normalized minimal workflow (non-strict)', async () => {
    const env = makeFakeFactory();
    const f = path.join(tmpDir, 'ok.json');
    await fs.writeFile(
      f,
      JSON.stringify({
        ...WF,
        settings: {
          saveDataErrorExecution: 'all',
          saveDataSuccessExecution: 'all',
          saveManualExecutions: true,
          executionOrder: 'v1',
        },
      }),
    );
    await validateHandler(env.factory, {}, [f]);
    expect(process.exitCode).toBeUndefined();
  });

  it('normalize writes the output file and emits change events', async () => {
    const env = makeFakeFactory();
    const f = path.join(tmpDir, 'raw.json');
    const out = path.join(tmpDir, 'norm.json');
    await fs.writeFile(
      f,
      JSON.stringify({ name: 'x', nodes: [{ id: 'bogus', name: 'N', type: 'n8n-nodes-base.set', typeVersion: 1, position: [0, 0], parameters: {} }], connections: {} }),
    );
    await normalizeHandler(env.factory, { output: out }, [f]);
    const norm = JSON.parse(await fs.readFile(out, 'utf8'));
    expect(norm.nodes[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.events.some((e) => e.event === 'workflow-normalized')).toBe(true);
  });

  it('normalize dry-run does not write', async () => {
    const env = makeFakeFactory({ dryRun: true });
    const f = path.join(tmpDir, 'raw.json');
    const out = path.join(tmpDir, 'norm.json');
    await fs.writeFile(f, JSON.stringify(WF));
    await normalizeHandler(env.factory, { output: out }, [f]);
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('schema (default) prints the workflow resource shape', async () => {
    const env = makeFakeFactory({ json: true });
    await schemaHandler(env.factory, {}, []);
    expect(env.stdout()).toContain('readOnlyFields');
    expect(env.stdout()).toContain('connections');
  });
});

describe('statusHandler — semantic exit values', () => {
  it('yields exitCode 0 for an active workflow (non-TTY)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    env.apiMock.onGet('/executions').reply(200, { data: [] });
    await statusHandler(env.factory, {}, ['w1']);
    expect(process.exitCode).toBe(0);
  });

  it('yields exitCode 1 for an inactive workflow (non-TTY)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, { ...WF, active: false });
    env.apiMock.onGet('/executions').reply(200, { data: [] });
    await statusHandler(env.factory, {}, ['w1']);
    expect(process.exitCode).toBe(1);
  });
});

describe('exportAllHandler / importHandler', () => {
  it('export-all writes one file per workflow', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply((cfg) => {
      const params = (cfg.params ?? {}) as Record<string, unknown>;
      if (params.cursor) return [200, { data: [], nextCursor: null }];
      return [200, { data: [WF, { ...WF, id: 'w2', name: 'Two' }], nextCursor: null }];
    });
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    env.apiMock.onGet('/workflows/w2').reply(200, { ...WF, id: 'w2', name: 'Two' });
    const out = path.join(tmpDir, 'exp');
    await exportAllHandler(env.factory, { output: out }, []);
    const files = await fs.readdir(out);
    expect(files).toHaveLength(2);
  });

  it('import creates id-less files and skips existing without --force', async () => {
    const env = makeFakeFactory();
    const dir = path.join(tmpDir, 'imp');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'new.json'), JSON.stringify({ name: 'New', nodes: [], connections: {} }));
    await fs.writeFile(path.join(dir, 'existing.json'), JSON.stringify(WF));
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    let posted = 0;
    env.apiMock.onPost('/workflows').reply(() => {
      posted++;
      return [200, { id: 'wNew', name: 'New', active: false }];
    });
    await importHandler(env.factory, {}, [dir]);
    expect(posted).toBe(1);
    expect(env.stdout()).toContain('1 created, 0 updated, 1 skipped, 0 failed');
  });

  it('import dry-run lists planned actions without API calls', async () => {
    const env = makeFakeFactory({ dryRun: true });
    const dir = path.join(tmpDir, 'imp2');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'a.json'), JSON.stringify({ name: 'A', nodes: [], connections: {} }));
    await importHandler(env.factory, {}, [dir]);
    expect(env.stdout()).toContain('[dry-run] create');
  });
});

describe('triggerWebhookHandler', () => {
  const WEBHOOK_WF = {
    ...WF,
    nodes: [
      ...WF.nodes,
      {
        id: 'b2c3d4e5-f6a7-4890-bcde-f12345678901',
        name: 'Hook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 100],
        parameters: { path: 'my-hook', httpMethod: 'POST' },
      },
    ],
  };

  it('throws ValidationError when the workflow has no webhook node', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WF);
    await expect(triggerWebhookHandler(env.factory, {}, ['w1'])).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when workflow is inactive (production webhook unregistered)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, { ...WEBHOOK_WF, active: false });
    await expect(triggerWebhookHandler(env.factory, {}, ['w1'])).rejects.toThrow(/INACTIVE/);
  });

  it('dry-run does not call the webhook', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/workflows/w1').reply(200, WEBHOOK_WF);
    let hit = false;
    env.webhookMock.onAny().reply(() => {
      hit = true;
      return [200, {}];
    });
    await triggerWebhookHandler(env.factory, {}, ['w1']);
    expect(hit).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
  });

  it('POSTs the payload to the webhook URL and prints the response', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WEBHOOK_WF);
    env.webhookMock.onPost('https://test.example.com/webhook/my-hook').reply(200, { ok: true });
    await triggerWebhookHandler(env.factory, { data: '{"x":1}' }, ['w1']);
    expect(env.stderr()).toContain('webhook accepted');
    expect(env.stdout()).toContain('"ok": true');
  });
});

describe('execution handlers', () => {
  it('get passes includeData when --logs', async () => {
    const env = makeFakeFactory({ json: true });
    let params: Record<string, unknown> | undefined;
    env.apiMock.onGet('/executions/e1').reply((cfg) => {
      params = cfg.params as Record<string, unknown>;
      return [200, { id: 'e1', status: 'success' }];
    });
    await getExecutionHandler(env.factory, { logs: true }, ['e1']);
    expect(params?.includeData).toBe(true);
    expect(env.stdout()).toContain('"id": "e1"');
  });

  it('retry POSTs to the internal /rest endpoint and prints the new execution id', async () => {
    const env = makeFakeFactory();
    env.sessionMock().onPost('/executions/e1/retry').reply(200, { data: { id: 'e2', status: 'running' } });
    await retryHandler(env.factory, {}, ['e1']);
    expect(env.stdout()).toContain('e2');
    // emits the mutation event on the NDJSON stream
    expect(env.events.some((e) => e.event === 'execution-retried')).toBe(true);
  });

  it('retry --load-workflow sends loadWorkflow:true in the /rest body', async () => {
    const env = makeFakeFactory();
    let body: Record<string, unknown> | undefined;
    env.sessionMock().onPost('/executions/e1/retry').reply((cfg) => {
      body = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, { data: { id: 'e3' } }];
    });
    await retryHandler(env.factory, { loadWorkflow: true }, ['e1']);
    expect(body?.loadWorkflow).toBe(true);
    expect(env.stdout()).toContain('e3');
  });

  it('last-error reports clean when no failed executions', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions').reply(200, { data: [] });
    await lastErrorHandler(env.factory, { workflow: 'w1' }, []);
    expect(env.stdout()).toContain('no failed executions');
  });

  it('last-error --summary extracts the failing node', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions').reply(200, {
      data: [{
        id: 'e9',
        stoppedAt: '2026-06-12T10:00:00Z',
        data: { resultData: { error: { node: { name: 'HTTP Request' }, message: 'boom' } } },
      }],
    });
    await lastErrorHandler(env.factory, { workflow: 'w1', summary: true }, []);
    expect(env.stdout()).toContain('HTTP Request');
    expect(env.stdout()).toContain('boom');
  });
});

describe('tag / credential handlers', () => {
  it('tag create dry-run does not POST', async () => {
    const env = makeFakeFactory({ dryRun: true });
    let posted = false;
    env.apiMock.onPost('/tags').reply(() => {
      posted = true;
      return [200, {}];
    });
    await createTagHandler(env.factory, {}, ['newtag']);
    expect(posted).toBe(false);
  });

  it('tag create POSTs and prints id', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPost('/tags').reply(200, { id: 't9', name: 'newtag' });
    await createTagHandler(env.factory, {}, ['newtag']);
    expect(env.stdout()).toContain('t9');
  });

  it('tag list --all paginates', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/tags').reply((cfg) => {
      const cursor = (cfg.params as Record<string, unknown>)?.cursor;
      if (cursor) return [200, { data: [{ id: 't2', name: 'b' }], nextCursor: null }];
      return [200, { data: [{ id: 't1', name: 'a' }], nextCursor: 'c' }];
    });
    await listTagsHandler(env.factory, { all: true }, []);
    expect(JSON.parse(env.stdout())).toHaveLength(2);
  });

  it('credential schema GETs the type schema', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/credentials/schema/httpHeaderAuth').reply(200, {
      type: 'object',
      required: ['name', 'value'],
    });
    await credentialSchemaHandler(env.factory, {}, ['httpHeaderAuth']);
    expect(env.stdout()).toContain('required');
  });
});

describe('config handlers (temp config dir)', () => {
  let cfgDir: string;
  beforeEach(async () => {
    cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-cfg-'));
    process.env.N8NCTL_CONFIG_DIR = cfgDir;
  });
  afterEach(async () => {
    delete process.env.N8NCTL_CONFIG_DIR;
    await fs.rm(cfgDir, { recursive: true, force: true });
  });

  it('set then get round-trips a value', async () => {
    const env = makeFakeFactory();
    await configSetHandler(env.factory, {}, ['settings.outputFormat', 'json']);
    expect(env.stdout()).toContain('settings.outputFormat');
    const env2 = makeFakeFactory();
    await configGetHandler(env2.factory, {}, ['settings.outputFormat']);
    expect(env2.stdout().trim()).toBe('json');
  });

  it('get rejects unknown keys', async () => {
    const env = makeFakeFactory();
    await expect(configGetHandler(env.factory, {}, ['profiles.default.apiKey'])).rejects.toThrow(
      ValidationError,
    );
  });

  it('set rejects invalid enum values', async () => {
    const env = makeFakeFactory();
    await expect(
      configSetHandler(env.factory, {}, ['settings.outputFormat', 'xml']),
    ).rejects.toThrow(ValidationError);
  });
});

describe('doctorHandler', () => {
  let cfgDir: string;
  let savedEnv: { key?: string; host?: string };
  beforeEach(async () => {
    cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-doc-'));
    process.env.N8NCTL_CONFIG_DIR = cfgDir;
    savedEnv = { key: process.env.N8N_API_KEY, host: process.env.N8N_HOST };
    process.env.N8N_API_KEY = 'k';
    process.env.N8N_HOST = 'https://test.example.com';
  });
  afterEach(async () => {
    delete process.env.N8NCTL_CONFIG_DIR;
    if (savedEnv.key === undefined) delete process.env.N8N_API_KEY;
    else process.env.N8N_API_KEY = savedEnv.key;
    if (savedEnv.host === undefined) delete process.env.N8N_HOST;
    else process.env.N8N_HOST = savedEnv.host;
    await fs.rm(cfgDir, { recursive: true, force: true });
  });

  it('runs all checks green against a mocked instance (incl. --verbose stats)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, { data: [WF], nextCursor: null }, {
      'x-n8n-version': '1.122.5',
    });
    env.apiMock.onGet('/tags').reply(200, { data: [] });
    env.apiMock.onGet('/executions').reply(200, { data: [{ status: 'success' }] });
    env.apiMock.onPost('/tags').reply(201, { id: 'p1', name: 'n8nctl-doctor-probe' });
    env.apiMock.onDelete('/tags/p1').reply(200, {});

    await doctorHandler(env.factory, { verbose: true }, []);

    const out = env.stdout();
    expect(out).toContain('Auth resolution');
    expect(out).toContain('API connectivity');
    expect(out).toContain('Write permission');
    expect(out).toContain('Server stats');
    expect(out).toContain('1.122.5');
    expect(out).toMatch(/Summary.*0 fail/);
    expect(process.exitCode).toBeUndefined();
  });

  it('sets exitCode 1 when connectivity fails', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(500, { message: 'down' });
    env.apiMock.onGet('/tags').reply(500, {});
    env.apiMock.onGet('/executions').reply(500, {});
    env.apiMock.onPost('/tags').reply(500, {});
    await doctorHandler(env.factory, {}, []);
    expect(process.exitCode).toBe(1);
  });
});
