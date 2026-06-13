import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { promoteHandler } from '../src/commands/workflow/promote.js';
import { ValidationError } from '../src/lib/errors.js';

let tmpDir: string;
let savedExit: number | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-promo-'));
  savedExit = process.exitCode;
  process.exitCode = undefined;
});
afterEach(async () => {
  process.exitCode = savedExit;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const sourceWf = (creds: Record<string, { id?: string; name?: string }>) => ({
  id: 'w1',
  name: 'Promote Me',
  active: false,
  nodes: [
    { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {}, credentials: creds },
  ],
  connections: {},
});

// Target workflow that exposes one credential {t-http-1, Prod API, httpHeaderAuth}
const targetCredWf = {
  id: 'tw1',
  name: 'Has Creds',
  nodes: [
    { name: 'N', type: 'n8n-nodes-base.httpRequest', credentials: { httpHeaderAuth: { id: 't-http-1', name: 'Prod API' } } },
  ],
  connections: {},
};

function wireTarget(env: ReturnType<typeof makeFakeFactory>, existingByName?: unknown) {
  const tm = env.targetMock();
  // credential derivation + create-or-update both paginate /workflows
  tm.onGet('/workflows').reply(200, {
    data: existingByName ? [targetCredWf, existingByName] : [targetCredWf],
    nextCursor: null,
  });
  tm.onGet('/workflows/tw1').reply(200, targetCredWf);
  if (existingByName) {
    const ex = existingByName as { id: string };
    tm.onGet(`/workflows/${ex.id}`).reply(200, existingByName);
  }
  return tm;
}

describe('promoteHandler', () => {
  it('requires --to', async () => {
    const env = makeFakeFactory();
    await expect(promoteHandler(env.factory, {}, ['w1'])).rejects.toThrow(/--to/);
  });

  it('blocks (ValidationError) on an unmapped credential without --allow-unmapped', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, sourceWf({ telegramApi: { id: 's-x', name: 'Bot' } }));
    wireTarget(env);
    await expect(promoteHandler(env.factory, { to: 'prod' }, ['w1'])).rejects.toThrow(/no match/);
  });

  it('blocks on ambiguous match even WITH --allow-unmapped', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, sourceWf({ httpBasicAuth: { id: 's-y', name: 'Shared' } }));
    const tm = env.targetMock();
    const dupWf = {
      id: 'tw1',
      name: 'Dups',
      nodes: [
        { name: 'A', type: 't', credentials: { httpBasicAuth: { id: 'd-a', name: 'Shared' } } },
        { name: 'B', type: 't', credentials: { httpBasicAuth: { id: 'd-b', name: 'Shared' } } },
      ],
      connections: {},
    };
    tm.onGet('/workflows').reply(200, { data: [dupWf], nextCursor: null });
    tm.onGet('/workflows/tw1').reply(200, dupWf);
    await expect(
      promoteHandler(env.factory, { to: 'prod', allowUnmapped: true }, ['w1']),
    ).rejects.toThrow(/MULTIPLE/);
  });

  it('creates on target when no same-name workflow exists, remapping credentials', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, sourceWf({ httpHeaderAuth: { id: 's-1', name: 'Prod API' } }));
    const tm = wireTarget(env);
    let postedBody: Record<string, unknown> = {};
    tm.onPost('/workflows').reply((cfg) => {
      postedBody = JSON.parse(cfg.data as string);
      return [200, { id: 'new-1', name: 'Promote Me', active: false }];
    });
    await promoteHandler(env.factory, { to: 'prod' }, ['w1']);
    // 4-field whitelist only
    expect(Object.keys(postedBody).sort()).toEqual(['connections', 'name', 'nodes']);
    // credential rewritten to target id
    const node = (postedBody.nodes as Array<{ credentials: Record<string, { id: string }> }>)[0];
    expect(node.credentials.httpHeaderAuth.id).toBe('t-http-1');
    expect(env.stdout()).toContain('created');
  });

  it('updates the same-name workflow on target when it exists', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, sourceWf({ httpHeaderAuth: { id: 's-1', name: 'Prod API' } }));
    const existing = { id: 'ex-9', name: 'Promote Me', nodes: [], connections: {} };
    const tm = wireTarget(env, existing);
    let put = false;
    tm.onPut('/workflows/ex-9').reply(() => {
      put = true;
      return [200, { id: 'ex-9', name: 'Promote Me', active: false }];
    });
    await promoteHandler(env.factory, { to: 'prod' }, ['w1']);
    expect(put).toBe(true);
    expect(env.stdout()).toContain('updated');
  });

  it('writes artifacts with --out-dir and does not POST under --dry-run', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/workflows/w1').reply(200, sourceWf({ httpHeaderAuth: { id: 's-1', name: 'Prod API' } }));
    const tm = wireTarget(env);
    let posted = false;
    tm.onPost('/workflows').reply(() => {
      posted = true;
      return [200, {}];
    });
    await promoteHandler(env.factory, { to: 'prod', outDir: tmpDir }, ['w1']);
    expect(posted).toBe(false);
    const files = await fs.readdir(tmpDir);
    expect(files.sort()).toEqual(['mapping-report.json', 'promoted-workflow.json', 'target-diff.json']);
    const promoted = JSON.parse(await fs.readFile(path.join(tmpDir, 'promoted-workflow.json'), 'utf8'));
    expect(promoted.nodes[0].credentials.httpHeaderAuth.id).toBe('t-http-1');
    expect(env.stdout()).toContain('[dry-run]');
  });

  it('resolves an unmapped credential via --map file', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, sourceWf({ telegramApi: { id: 's-x', name: 'Bot' } }));
    const tm = wireTarget(env);
    const mapFile = path.join(tmpDir, 'map.json');
    await fs.writeFile(mapFile, JSON.stringify([{ sourceId: 's-x', targetId: 't-tg-1', targetName: 'Prod Bot' }]));
    let postedBody: Record<string, unknown> = {};
    tm.onPost('/workflows').reply((cfg) => {
      postedBody = JSON.parse(cfg.data as string);
      return [200, { id: 'new-2', name: 'Promote Me' }];
    });
    await promoteHandler(env.factory, { to: 'prod', map: mapFile }, ['w1']);
    const node = (postedBody.nodes as Array<{ credentials: Record<string, { id: string }> }>)[0];
    expect(node.credentials.telegramApi.id).toBe('t-tg-1');
  });
});
