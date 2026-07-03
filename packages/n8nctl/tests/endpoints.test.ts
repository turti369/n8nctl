import { describe, it, expect } from 'vitest';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { executionDeleteHandler } from '../src/commands/execution/delete.js';
import { updateTagHandler } from '../src/commands/tag/update.js';
import { deleteTagHandler } from '../src/commands/tag/delete.js';
import { deleteCredentialHandler } from '../src/commands/credential/delete.js';
import { transferCredentialHandler } from '../src/commands/credential/transfer.js';
import { transferWorkflowHandler } from '../src/commands/workflow/transfer.js';
import { ApiError, ValidationError } from '../src/lib/errors.js';

// fake-factory io is non-TTY, so confirm gates are skipped (as when piped).

describe('new endpoint verbs', () => {
  it('execution delete → DELETE /executions/{id}', async () => {
    const env = makeFakeFactory();
    let hit = false;
    env.apiMock.onDelete('/executions/e1').reply(() => {
      hit = true;
      return [200, {}];
    });
    await executionDeleteHandler(env.factory, {}, ['e1']);
    expect(hit).toBe(true);
    expect(env.stdout()).toContain('deleted execution');
  });

  it('tag update → PUT /tags/{id} with new name', async () => {
    const env = makeFakeFactory();
    let body: Record<string, unknown> | undefined;
    env.apiMock.onPut('/tags/t1').reply((cfg) => {
      body = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, { id: 't1', name: 'renamed' }];
    });
    await updateTagHandler(env.factory, {}, ['t1', 'renamed']);
    expect(body?.name).toBe('renamed');
    expect(env.stdout()).toContain('renamed');
  });

  it('tag delete → DELETE /tags/{id}', async () => {
    const env = makeFakeFactory();
    env.apiMock.onDelete('/tags/t1').reply(200, {});
    await deleteTagHandler(env.factory, {}, ['t1']);
    expect(env.stdout()).toContain('deleted tag');
  });

  it('credential delete → DELETE /credentials/{id}', async () => {
    const env = makeFakeFactory();
    env.apiMock.onDelete('/credentials/c1').reply(200, {});
    await deleteCredentialHandler(env.factory, {}, ['c1']);
    expect(env.stdout()).toContain('deleted credential');
  });

  it('credential transfer → PUT /credentials/{id}/transfer with destinationProjectId', async () => {
    const env = makeFakeFactory();
    let body: Record<string, unknown> | undefined;
    env.apiMock.onPut('/credentials/c1/transfer').reply((cfg) => {
      body = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, {}];
    });
    await transferCredentialHandler(env.factory, { to: 'proj-9' }, ['c1']);
    expect(body?.destinationProjectId).toBe('proj-9');
    expect(env.stdout()).toContain('transferred credential');
  });

  it('credential transfer requires --to', async () => {
    const env = makeFakeFactory();
    await expect(transferCredentialHandler(env.factory, {}, ['c1'])).rejects.toThrow(ValidationError);
  });

  it('workflow transfer → PUT /workflows/{id}/transfer', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPut('/workflows/w1/transfer').reply(200, {});
    await transferWorkflowHandler(env.factory, { to: 'proj-9' }, ['w1']);
    expect(env.stdout()).toContain('transferred workflow');
  });

  it('workflow transfer maps a 403 to a licensed-feature hint', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPut('/workflows/w1/transfer').reply(403, { message: 'forbidden' });
    try {
      await transferWorkflowHandler(env.factory, { to: 'proj-9' }, ['w1']);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).hint).toMatch(/licensed/i);
    }
  });

  it('honours --dry-run (no API call)', async () => {
    const env = makeFakeFactory({ dryRun: true });
    let hit = false;
    env.apiMock.onDelete('/executions/e1').reply(() => {
      hit = true;
      return [200, {}];
    });
    await executionDeleteHandler(env.factory, {}, ['e1']);
    expect(hit).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
  });
});
