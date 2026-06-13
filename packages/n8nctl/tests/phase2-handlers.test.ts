import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { variableListHandler } from '../src/commands/variable/list.js';
import { variableSetHandler } from '../src/commands/variable/set.js';
import { variableDeleteHandler } from '../src/commands/variable/delete.js';
import { auditHandler } from '../src/commands/audit.js';
import { userListHandler } from '../src/commands/user/index.js';
import { projectListHandler } from '../src/commands/project/index.js';
import { sourceControlPullHandler } from '../src/commands/source-control/index.js';
import { scaffoldHandler } from '../src/commands/workflow/scaffold.js';
import { validateHandler } from '../src/commands/workflow/validate.js';
import { doctorHandler } from '../src/commands/doctor.js';
import { ValidationError, ApiError } from '../src/lib/errors.js';

let tmpDir: string;
let savedExit: number | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-p2-'));
  savedExit = process.exitCode;
  process.exitCode = undefined;
});

afterEach(async () => {
  process.exitCode = savedExit;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('variable handlers', () => {
  it('list paginates and prints variables', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/variables').reply(200, { data: [{ id: 'v1', key: 'API_URL', value: 'x' }] });
    await variableListHandler(env.factory, {}, []);
    expect(JSON.parse(env.stdout())).toHaveLength(1);
  });

  it('list maps 403 to a license hint (community edition)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/variables').reply(403, { message: 'forbidden' });
    await expect(variableListHandler(env.factory, {}, [])).rejects.toMatchObject({
      name: 'ApiError',
      hint: expect.stringContaining('licensed'),
    });
  });

  it('set creates when the key does not exist', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/variables').reply(200, { data: [] });
    let posted: Record<string, unknown> = {};
    env.apiMock.onPost('/variables').reply((cfg) => {
      posted = JSON.parse(cfg.data as string);
      return [200, { id: 'v9', key: 'NEW', value: '1' }];
    });
    await variableSetHandler(env.factory, {}, ['NEW', '1']);
    expect(posted).toEqual({ key: 'NEW', value: '1' });
    expect(env.stdout()).toContain('created variable');
  });

  it('set updates by id when the key exists (PUT)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/variables').reply(200, { data: [{ id: 'v1', key: 'API_URL', value: 'old' }] });
    let put: Record<string, unknown> = {};
    env.apiMock.onPut('/variables/v1').reply((cfg) => {
      put = JSON.parse(cfg.data as string);
      return [200, {}];
    });
    await variableSetHandler(env.factory, {}, ['API_URL', 'new']);
    expect(put).toEqual({ key: 'API_URL', value: 'new' });
    expect(env.stdout()).toContain('updated variable');
  });

  it('set falls back to delete+create when PUT is unsupported (405)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/variables').reply(200, { data: [{ id: 'v1', key: 'K', value: 'old' }] });
    env.apiMock.onPut('/variables/v1').reply(405, {});
    let deleted = false;
    let posted = false;
    env.apiMock.onDelete('/variables/v1').reply(() => {
      deleted = true;
      return [200, {}];
    });
    env.apiMock.onPost('/variables').reply(() => {
      posted = true;
      return [200, { id: 'v2', key: 'K' }];
    });
    await variableSetHandler(env.factory, {}, ['K', 'new']);
    expect(deleted).toBe(true);
    expect(posted).toBe(true);
  });

  it('set dry-run does not mutate', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/variables').reply(200, { data: [] });
    let mutated = false;
    env.apiMock.onPost('/variables').reply(() => {
      mutated = true;
      return [200, {}];
    });
    await variableSetHandler(env.factory, {}, ['K', 'v']);
    expect(mutated).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
  });

  it('delete resolves by key then DELETEs by id; unknown key throws', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/variables').reply(200, { data: [{ id: 'v1', key: 'K' }] });
    let deleted = false;
    env.apiMock.onDelete('/variables/v1').reply(() => {
      deleted = true;
      return [200, {}];
    });
    await variableDeleteHandler(env.factory, {}, ['K']);
    expect(deleted).toBe(true);

    const env2 = makeFakeFactory();
    env2.apiMock.onGet('/variables').reply(200, { data: [] });
    await expect(variableDeleteHandler(env2.factory, {}, ['NOPE'])).rejects.toThrow(ValidationError);
  });
});

describe('audit / user / project handlers', () => {
  it('audit POSTs with category options and prints the report', async () => {
    const env = makeFakeFactory({ json: true });
    let body: Record<string, unknown> = {};
    env.apiMock.onPost('/audit').reply((cfg) => {
      body = JSON.parse(cfg.data as string);
      return [200, { 'Credentials Risk Report': { risk: 'none' } }];
    });
    await auditHandler(env.factory, { categories: 'credentials,instance', daysAbandoned: '30' }, []);
    expect(body.additionalOptions).toMatchObject({
      categories: ['credentials', 'instance'],
      daysAbandonedWorkflow: 30,
    });
    expect(env.stdout()).toContain('Credentials Risk Report');
  });

  it('audit rejects unknown categories before any API call', async () => {
    const env = makeFakeFactory();
    await expect(auditHandler(env.factory, { categories: 'nope' }, [])).rejects.toThrow(ValidationError);
  });

  it('user list paginates and prints', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/users').reply(200, {
      data: [{ id: 'u1', email: 'a@b.com', role: 'global:owner' }],
    });
    await userListHandler(env.factory, {}, []);
    expect(JSON.parse(env.stdout())[0].email).toBe('a@b.com');
  });

  it('project list maps 403 to a license hint', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/projects').reply(403, {});
    await expect(projectListHandler(env.factory, {}, [])).rejects.toMatchObject({
      hint: expect.stringContaining('licensed'),
    });
  });
});

describe('sourceControlPullHandler — guardrails', () => {
  it('non-TTY without --yes fails CLOSED after writing the bundle, before POST', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, { data: [{ id: 'w1', name: 'A' }], nextCursor: null });
    env.apiMock.onGet('/workflows/w1').reply(200, { id: 'w1', name: 'A', nodes: [], connections: {} });
    let pulled = false;
    env.apiMock.onPost('/source-control/pull').reply(() => {
      pulled = true;
      return [200, {}];
    });
    await expect(
      sourceControlPullHandler(env.factory, { backupDir: tmpDir }, []),
    ).rejects.toThrow(/--yes/);
    expect(pulled).toBe(false);
    // bundle was still written (rollback point exists even on abort)
    const dirs = await fs.readdir(tmpDir);
    expect(dirs.some((d) => d.startsWith('pre-pull-'))).toBe(true);
  });

  it('--yes: snapshots every workflow then POSTs pull with force flag', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/workflows').reply(200, {
      data: [
        { id: 'w1', name: 'A' },
        { id: 'w2', name: 'B' },
      ],
      nextCursor: null,
    });
    env.apiMock.onGet('/workflows/w1').reply(200, { id: 'w1', name: 'A', nodes: [], connections: {} });
    env.apiMock.onGet('/workflows/w2').reply(200, { id: 'w2', name: 'B', nodes: [], connections: {} });
    let body: Record<string, unknown> = {};
    env.apiMock.onPost('/source-control/pull').reply((cfg) => {
      body = JSON.parse(cfg.data as string);
      return [200, { workflows: [{ id: 'w1' }] }];
    });
    await sourceControlPullHandler(env.factory, { backupDir: tmpDir, yes: true, force: true }, []);
    expect(body).toEqual({ force: true });
    const bundle = (await fs.readdir(tmpDir)).find((d) => d.startsWith('pre-pull-'));
    expect(bundle).toBeDefined();
    expect(await fs.readdir(path.join(tmpDir, bundle as string))).toHaveLength(2);
  });

  it('maps license 403 to an actionable hint', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, { data: [], nextCursor: null });
    env.apiMock.onPost('/source-control/pull').reply(403, {});
    await expect(
      sourceControlPullHandler(env.factory, { backupDir: tmpDir, yes: true }, []),
    ).rejects.toMatchObject({ hint: expect.stringContaining('licensed') });
  });

  it('dry-run does nothing at all', async () => {
    const env = makeFakeFactory({ dryRun: true });
    await sourceControlPullHandler(env.factory, {}, []);
    expect(env.stdout()).toContain('[dry-run]');
    expect(await fs.readdir(tmpDir)).toHaveLength(0);
  });
});

describe('scaffoldHandler', () => {
  it('produces byte-stable output across runs (deterministic ids)', async () => {
    const env1 = makeFakeFactory();
    const env2 = makeFakeFactory();
    await scaffoldHandler(env1.factory, { from: 'webhook', name: 'My Hook' }, []);
    await scaffoldHandler(env2.factory, { from: 'webhook', name: 'My Hook' }, []);
    expect(env1.stdout()).toBe(env2.stdout());
    const wf = JSON.parse(env1.stdout());
    expect(wf.nodes[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('scaffold output passes validate --policy strict end-to-end', async () => {
    const env = makeFakeFactory();
    const out = path.join(tmpDir, 'scaffold.json');
    await scaffoldHandler(env.factory, { from: 'cron', name: 'Hourly Job', output: out }, []);
    const env2 = makeFakeFactory();
    // throws on failure; strict means even MEDIUM would block
    await validateHandler(env2.factory, { policy: 'strict' }, [out]);
  });

  it('uses a template FILE as base, renaming it', async () => {
    const env = makeFakeFactory();
    const tpl = path.join(tmpDir, 'tpl.json');
    await fs.writeFile(
      tpl,
      JSON.stringify({
        name: 'Template',
        nodes: [{ name: 'Manual', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
        connections: {},
      }),
    );
    await scaffoldHandler(env.factory, { from: tpl, name: 'Renamed' }, []);
    expect(JSON.parse(env.stdout()).name).toBe('Renamed');
  });

  it('rejects unknown template names that are not files', async () => {
    const env = makeFakeFactory();
    await expect(scaffoldHandler(env.factory, { from: 'ghost-template' }, [])).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('validate --fix', () => {
  it('applies normalize fixes in place then validates clean', async () => {
    const env = makeFakeFactory();
    const f = path.join(tmpDir, 'fixme.json');
    await fs.writeFile(
      f,
      JSON.stringify({
        name: 'Fix Me',
        nodes: [{ id: 'bogus', name: 'M', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
        connections: {},
      }),
    );
    await validateHandler(env.factory, { fix: true, policy: 'strict' }, [f]);
    const fixed = JSON.parse(await fs.readFile(f, 'utf8'));
    expect(fixed.nodes[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fixed.settings.saveManualExecutions).toBe(true);
    expect(env.stderr()).toContain('--fix applied');
  });
});

describe('doctor license probes + remediation (json mode)', () => {
  let cfgDir: string;
  let savedEnv: { key?: string; host?: string };
  beforeEach(async () => {
    cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-doc2-'));
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

  it('reports license-gated features as warn with remediation, json output', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/workflows').reply(200, { data: [] });
    env.apiMock.onGet('/tags').reply(200, { data: [] });
    env.apiMock.onGet('/executions').reply(200, { data: [] });
    env.apiMock.onPost('/tags').reply(201, { id: 'p1', name: 'n8nctl-doctor-probe' });
    env.apiMock.onDelete('/tags/p1').reply(200, {});
    env.apiMock.onGet('/variables').reply(403, {});
    env.apiMock.onGet('/projects').reply(200, { data: [] });

    await doctorHandler(env.factory, {}, []);
    const out = JSON.parse(env.stdout());
    const varCheck = out.checks.find((ch: { name: string }) => ch.name.includes('Variables'));
    expect(varCheck.status).toBe('warn');
    expect(varCheck.detail).toContain('license-gated');
    expect(varCheck.remediation).toBeDefined();
    const projCheck = out.checks.find((ch: { name: string }) => ch.name.includes('Projects'));
    expect(projCheck.status).toBe('ok');
    expect(out.ok).toBe(true);
  });
});
