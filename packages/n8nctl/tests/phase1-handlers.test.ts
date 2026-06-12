import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { verifyHandler } from '../src/commands/workflow/verify.js';
import { logsHandler } from '../src/commands/execution/logs.js';
import { rollbackHandler } from '../src/commands/workflow/rollback.js';
import { triggerWebhookHandler } from '../src/commands/workflow/trigger-webhook.js';
import { selectRollbackTarget, isBackupForWorkflow } from '../src/lib/lifecycle/rollback.js';
import { ValidationError, AssertionFailedError } from '../src/lib/errors.js';

let tmpDir: string;
let savedExit: number | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-p1-'));
  savedExit = process.exitCode;
  process.exitCode = undefined;
});

afterEach(async () => {
  process.exitCode = savedExit;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const SUCCESS_EXEC = {
  id: 'e1',
  finished: true,
  status: 'success',
  workflowId: 'w1',
  startedAt: '2026-06-12T10:00:00.000Z',
  stoppedAt: '2026-06-12T10:00:02.000Z',
  data: {
    resultData: {
      lastNodeExecuted: 'Done',
      runData: {
        Done: [
          {
            executionTime: 42,
            data: { main: [[{ json: { title: 'T', secretToken: 'tk-abc', apiKey: 'k-123' } }]] },
          },
        ],
      },
    },
  },
};

describe('verifyHandler', () => {
  it('gates the latest execution and passes (exit code untouched)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions').reply(200, { data: [{ id: 'e1' }] });
    env.apiMock.onGet('/executions/e1').reply(200, SUCCESS_EXEC);
    await verifyHandler(env.factory, {}, ['w1']);
    expect(env.stdout()).toContain('GATE PASSED');
    expect(process.exitCode).toBeUndefined();
  });

  it('sets exit code 6 (AssertionFailed) when the gate fails — not 1-5', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions/e9').reply(200, { ...SUCCESS_EXEC, id: 'e9', status: 'error' });
    await verifyHandler(env.factory, { execution: 'e9' }, ['w1']);
    expect(process.exitCode).toBe(6);
    expect(env.stdout()).toContain('GATE FAILED');
  });

  it('verifies a specific execution via --execution without listing', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/executions/e1').reply(200, SUCCESS_EXEC);
    await verifyHandler(env.factory, { execution: 'e1' }, ['w1']);
    const report = JSON.parse(env.stdout());
    expect(report.gate).toBe('PASS');
    expect(report.executionId).toBe('e1');
  });

  it('applies an expectation FILE (yaml) merged with flag fields', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/executions/e1').reply(200, SUCCESS_EXEC);
    const f = path.join(tmpDir, 'expect.yml');
    await fs.writeFile(f, 'version: v1\nmaxDurationMs: 1\n'); // 2000ms run → TOT warn
    await verifyHandler(env.factory, { execution: 'e1', expect: f, expectFields: 'title' }, ['w1']);
    const report = JSON.parse(env.stdout());
    expect(report.gate).toBe('WARN_TOT');
    expect(report.checks.some((c: { tier: string }) => c.tier === 'du')).toBe(true);
  });

  it('fails with ValidationError when workflow has no executions', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions').reply(200, { data: [] });
    await expect(verifyHandler(env.factory, {}, ['w1'])).rejects.toThrow(ValidationError);
  });

  it('--capture writes a REDACTED artifact by default (secret-leak regression)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions/e1').reply(200, SUCCESS_EXEC);
    const cap = path.join(tmpDir, 'artifact.json');
    await verifyHandler(env.factory, { execution: 'e1', capture: cap }, ['w1']);
    const raw = await fs.readFile(cap, 'utf8');
    expect(raw).not.toContain('k-123');
    expect(raw).toContain('[REDACTED]');
    expect(raw).toContain('"gate"');
  });

  it('--run executes via session client then gates the new execution', async () => {
    const env = makeFakeFactory();
    const sm = env.sessionMock();
    sm.onGet('/workflows/w1').reply(200, {
      data: { id: 'w1', name: 'wf', nodes: [{ name: 'Manual', type: 'n8n-nodes-base.manualTrigger' }] },
    });
    sm.onPost('/workflows/w1/run').reply(200, { data: { executionId: 'e7' } });
    sm.onGet('/executions/e7').reply(200, { data: { id: 'e7', status: 'success', finished: true } });
    env.apiMock.onGet('/executions/e7').reply(200, { ...SUCCESS_EXEC, id: 'e7' });
    await verifyHandler(env.factory, { run: true, timeout: 5000 }, ['w1']);
    expect(env.stdout()).toContain('GATE PASSED');
  });

  it('dry-run reports the plan without any API call', async () => {
    const env = makeFakeFactory({ dryRun: true });
    await verifyHandler(env.factory, { expectFields: 'a' }, ['w1']);
    expect(env.stdout()).toContain('[dry-run]');
  });
});

describe('logsHandler', () => {
  const EXEC_WITH_ERROR = {
    id: 'e2',
    status: 'error',
    finished: true,
    data: {
      resultData: {
        lastNodeExecuted: 'Bad',
        runData: {
          Good: [{ executionTime: 10, data: { main: [[{ json: { ok: 1, password: 'hunter2' } }]] } }],
          Bad: [{ executionTime: 5, error: { message: 'boom' } }],
        },
      },
    },
  };

  it('renders per-node rows and exits 1 when a node errored', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/executions/e2').reply(200, EXEC_WITH_ERROR);
    await logsHandler(env.factory, {}, ['e2']);
    const out = JSON.parse(env.stdout());
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes.find((n: { node: string }) => n.node === 'Bad').error).toBe('boom');
    expect(process.exitCode).toBe(1);
  });

  it('--errors-only filters ok nodes; --node filters by name', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/executions/e2').reply(200, EXEC_WITH_ERROR);
    await logsHandler(env.factory, { errorsOnly: true }, ['e2']);
    const out = JSON.parse(env.stdout());
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].node).toBe('Bad');
  });

  it('--node unknown name throws, hinting which nodes ran', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions/e2').reply(200, EXEC_WITH_ERROR);
    await expect(logsHandler(env.factory, { node: 'Ghost' }, ['e2'])).rejects.toMatchObject({
      name: 'ValidationError',
      hint: expect.stringContaining('Good, Bad'),
    });
  });

  it('--io-data REDACTS secrets by default (secret-leak regression)', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/executions/e2').reply(200, EXEC_WITH_ERROR);
    await logsHandler(env.factory, { ioData: true }, ['e2']);
    expect(env.stdout()).not.toContain('hunter2');
    expect(env.stdout()).toContain('[REDACTED]');
  });

  it('--unsafe-raw-io bypasses redaction and warns on stderr', async () => {
    const env = makeFakeFactory({ json: true });
    env.apiMock.onGet('/executions/e2').reply(200, EXEC_WITH_ERROR);
    await logsHandler(env.factory, { ioData: true, unsafeRawIo: true }, ['e2']);
    expect(env.stdout()).toContain('hunter2');
    expect(env.stderr()).toContain('unsafe-raw-io');
  });

  it('throws an actionable error when execution data is pruned', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions/e3').reply(200, { id: 'e3', status: 'success' });
    await expect(logsHandler(env.factory, {}, ['e3'])).rejects.toThrow(/no run data/);
  });
});

describe('rollback target selection (lib)', () => {
  it('matches only backups of the given workflow id', () => {
    expect(isBackupForWorkflow('My_Flow_w1_2026.json', 'w1')).toBe(true);
    expect(isBackupForWorkflow('My_Flow_w12_2026.json', 'w1')).toBe(false);
    expect(isBackupForWorkflow('notes.txt', 'w1')).toBe(false);
  });

  it('picks the newest backup and EXCLUDES the just-written snapshot', async () => {
    const old = path.join(tmpDir, 'wf_w1_2026-01-01.json');
    const newer = path.join(tmpDir, 'wf_w1_2026-06-01.json');
    const snapshot = path.join(tmpDir, 'wf_w1_2026-06-12-pre-rollback.json');
    await fs.writeFile(old, '{}');
    await fs.writeFile(newer, '{}');
    await fs.writeFile(snapshot, '{}');
    const t0 = Date.now();
    await fs.utimes(old, new Date(t0 - 60_000), new Date(t0 - 60_000));
    await fs.utimes(newer, new Date(t0 - 30_000), new Date(t0 - 30_000));
    await fs.utimes(snapshot, new Date(t0), new Date(t0)); // newest on disk
    const target = await selectRollbackTarget(tmpDir, 'w1', { exclude: [snapshot] });
    expect(target.file).toBe(path.resolve(newer));
    expect(target.candidates).toHaveLength(2);
  });

  it('throws when no backups exist for the workflow', async () => {
    await expect(selectRollbackTarget(tmpDir, 'w1')).rejects.toThrow(ValidationError);
  });

  it('honors --to even outside the backup dir', async () => {
    const f = path.join(tmpDir, 'anything.json');
    await fs.writeFile(f, '{}');
    const target = await selectRollbackTarget(tmpDir, 'w1', { to: f });
    expect(target.file).toBe(path.resolve(f));
  });
});

describe('rollbackHandler', () => {
  const CURRENT = {
    id: 'w1',
    name: 'Flow',
    active: false,
    nodes: [{ id: 'n1', name: 'A', type: 'n8n-nodes-base.set', typeVersion: 1, position: [0, 0], parameters: { v: 'current' } }],
    connections: {},
  };
  const BACKUP = { ...CURRENT, nodes: [{ ...CURRENT.nodes[0], parameters: { v: 'old' } }] };

  it('dry-run: diff preview, no snapshot written, no PUT', async () => {
    const env = makeFakeFactory({ dryRun: true });
    env.apiMock.onGet('/workflows/w1').reply(200, CURRENT);
    const backupFile = path.join(tmpDir, 'Flow_w1_2026-06-01.json');
    await fs.writeFile(backupFile, JSON.stringify(BACKUP));
    let put = false;
    env.apiMock.onPut('/workflows/w1').reply(() => {
      put = true;
      return [200, BACKUP];
    });
    await rollbackHandler(env.factory, { backupDir: tmpDir }, ['w1']);
    expect(put).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
    const files = await fs.readdir(tmpDir);
    expect(files.some((f) => f.includes('pre-rollback'))).toBe(false);
  });

  it('non-TTY without --yes fails CLOSED before any PUT', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, CURRENT);
    const backupFile = path.join(tmpDir, 'Flow_w1_2026-06-01.json');
    await fs.writeFile(backupFile, JSON.stringify(BACKUP));
    let put = false;
    env.apiMock.onPut('/workflows/w1').reply(() => {
      put = true;
      return [200, BACKUP];
    });
    await expect(rollbackHandler(env.factory, { backupDir: tmpDir }, ['w1'])).rejects.toThrow(/--yes/);
    expect(put).toBe(false);
  });

  it('--yes: snapshot → restore → verify; snapshot excluded from target choice', async () => {
    const env = makeFakeFactory();
    let serverState = CURRENT;
    env.apiMock.onGet('/workflows/w1').reply(() => [200, serverState]);
    let putBody: Record<string, unknown> = {};
    env.apiMock.onPut('/workflows/w1').reply((cfg) => {
      putBody = JSON.parse(cfg.data as string);
      serverState = { ...BACKUP };
      return [200, BACKUP];
    });
    const backupFile = path.join(tmpDir, 'Flow_w1_2026-06-01.json');
    await fs.writeFile(backupFile, JSON.stringify(BACKUP));
    await rollbackHandler(env.factory, { backupDir: tmpDir, yes: true }, ['w1']);
    // whitelist keeps only fields PRESENT in the backup (no settings there)
    expect(Object.keys(putBody).sort()).toEqual(['connections', 'name', 'nodes']);
    expect(env.stdout()).toContain('rolled back');
    const files = await fs.readdir(tmpDir);
    expect(files.some((f) => f.includes('pre-rollback'))).toBe(true);
  });

  it('reports nothing-to-do when target equals current state', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, CURRENT);
    const backupFile = path.join(tmpDir, 'Flow_w1_2026-06-01.json');
    await fs.writeFile(backupFile, JSON.stringify(CURRENT));
    await rollbackHandler(env.factory, { backupDir: tmpDir, yes: true }, ['w1']);
    expect(env.stdout()).toContain('nothing to roll back');
  });
});

describe('trigger-webhook --expect-status / --capture', () => {
  const WEBHOOK_WF = {
    id: 'w1',
    name: 'Hooked',
    active: true,
    nodes: [
      {
        id: 'n2',
        name: 'Hook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        parameters: { path: 'p', httpMethod: 'POST' },
      },
    ],
    connections: {},
  };

  it('passes when the webhook returns the expected status (even non-2xx)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WEBHOOK_WF);
    env.webhookMock.onPost('https://test.example.com/webhook/p').reply(401, { msg: 'denied' });
    await triggerWebhookHandler(env.factory, { expectStatus: '401' }, ['w1']);
    expect(env.stderr()).toContain('expected HTTP 401');
    expect(process.exitCode).toBeUndefined();
  });

  it('throws AssertionFailedError (exit 6) on status mismatch', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WEBHOOK_WF);
    env.webhookMock.onPost('https://test.example.com/webhook/p').reply(500, { msg: 'kaput' });
    await expect(
      triggerWebhookHandler(env.factory, { expectStatus: '200' }, ['w1']),
    ).rejects.toThrow(AssertionFailedError);
  });

  it('--capture writes redacted response artifact', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/workflows/w1').reply(200, WEBHOOK_WF);
    env.webhookMock.onPost('https://test.example.com/webhook/p').reply(200, {
      ok: true,
      token: 'leak-me-not',
    });
    const cap = path.join(tmpDir, 'hook.json');
    await triggerWebhookHandler(env.factory, { capture: cap }, ['w1']);
    const raw = await fs.readFile(cap, 'utf8');
    expect(raw).toContain('"status": 200');
    expect(raw).not.toContain('leak-me-not');
  });
});
