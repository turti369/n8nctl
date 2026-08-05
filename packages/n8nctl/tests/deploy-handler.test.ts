import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { deployHandler } from '../src/commands/workflow/deploy.js';
import { ValidationError } from '../src/lib/errors.js';

let tmpDir: string;
let savedExit: number | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-deploy-'));
  savedExit = process.exitCode;
  process.exitCode = undefined;
});
afterEach(async () => {
  process.exitCode = savedExit;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// A clean workflow (known node + settings) that passes `ci` validation after normalize.
async function fixture(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const wf = {
    name,
    nodes: [
      { name: 'NoOp', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} },
    ],
    connections: {},
    settings: { executionOrder: 'v1', saveDataErrorExecution: 'all', saveManualExecutions: true },
    ...extra,
  };
  const file = path.join(tmpDir, `${name.replace(/\W/g, '_')}.json`);
  await fs.writeFile(file, JSON.stringify(wf), 'utf8');
  return file;
}

describe('workflow deploy — create/update resolution', () => {
  it('CREATES when no same-name workflow exists', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, { data: [], nextCursor: null });
    let posted = false;
    env.apiMock.onPost('/workflows').reply(() => {
      posted = true;
      return [200, { id: 'new-1', name: 'Deploy Me', active: false }];
    });
    await deployHandler(env.factory, {}, [await fixture('Deploy Me')]);
    expect(posted).toBe(true);
    expect(env.stdout()).toContain('new-1');
  });

  it('UPDATES the single same-name match', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, { data: [{ id: 'ex-1', name: 'Deploy Me' }], nextCursor: null });
    let put = false;
    env.apiMock.onPut('/workflows/ex-1').reply(() => {
      put = true;
      return [200, { id: 'ex-1', name: 'Deploy Me', active: false }];
    });
    await deployHandler(env.factory, {}, [await fixture('Deploy Me')]);
    expect(put).toBe(true);
    expect(env.stdout()).toContain('ex-1');
  });

  it('REFUSES (exit 3) when the name is ambiguous', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, {
      data: [{ id: 'a', name: 'Deploy Me' }, { id: 'b', name: 'Deploy Me' }],
      nextCursor: null,
    });
    await expect(deployHandler(env.factory, {}, [await fixture('Deploy Me')])).rejects.toThrow(
      /refusing to guess/,
    );
  });

  it('--create-only fails when a same-name workflow exists', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, { data: [{ id: 'ex-1', name: 'Deploy Me' }], nextCursor: null });
    await expect(
      deployHandler(env.factory, { createOnly: true }, [await fixture('Deploy Me')]),
    ).rejects.toThrow(/already exists/);
  });

  it('--update-only fails when nothing matches', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, { data: [], nextCursor: null });
    await expect(
      deployHandler(env.factory, { updateOnly: true }, [await fixture('Deploy Me')]),
    ).rejects.toThrow(/No workflow named/);
  });

  it('--id must exist', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/missing').reply(404, { message: 'not found' });
    await expect(
      deployHandler(env.factory, { id: 'missing' }, [await fixture('Deploy Me')]),
    ).rejects.toThrow(/does not exist/);
  });

  it('blocks (exit 3) on a CRITICAL validation issue by default', async () => {
    const env = makeFakeFactory();
    const leaky = await fixture('Leaky', {
      nodes: [
        {
          name: 'Set',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [0, 0],
          parameters: { h: 'Bearer abcdefghijklmnopqrstuvwxyz012345' },
        },
      ],
    });
    // validation runs before any network call → no mock needed
    await expect(deployHandler(env.factory, {}, [leaky])).rejects.toThrow(ValidationError);
  });

  it('--no-validate bypasses validation and still creates', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows').reply(200, { data: [], nextCursor: null });
    env.apiMock.onPost('/workflows').reply(200, { id: 'new-2', name: 'Leaky', active: false });
    const leaky = await fixture('Leaky', {
      nodes: [
        {
          name: 'Set',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [0, 0],
          parameters: { h: 'Bearer abcdefghijklmnopqrstuvwxyz012345' },
        },
      ],
    });
    await deployHandler(env.factory, { validate: false }, [leaky]);
    expect(env.stdout()).toContain('new-2');
  });

  it('--dry-run makes no write', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/workflows').reply(200, { data: [], nextCursor: null });
    let posted = false;
    env.apiMock.onPost('/workflows').reply(() => {
      posted = true;
      return [200, {}];
    });
    await deployHandler(env.factory, {}, [await fixture('Deploy Me')]);
    expect(posted).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
  });
});
