import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { userInviteHandler } from '../src/commands/user/invite.js';
import { userDeleteHandler } from '../src/commands/user/delete.js';
import { userRoleHandler } from '../src/commands/user/role.js';
import {
  projectCreateHandler,
  projectUpdateHandler,
  projectDeleteHandler,
  projectAddUserHandler,
  projectRemoveUserHandler,
} from '../src/commands/project/manage.js';
import { ApiError, ValidationError } from '../src/lib/errors.js';

let savedExit: number | undefined;
beforeEach(() => {
  savedExit = process.exitCode;
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = savedExit;
});

// fake-factory io is non-TTY → confirm gates are skipped (as when piped).

describe('user governance verbs', () => {
  it('invite POSTs an ARRAY of {email, role} and prints per-entry results', async () => {
    const env = makeFakeFactory();
    let body: unknown;
    env.apiMock.onPost('/users').reply((cfg) => {
      body = JSON.parse(cfg.data as string);
      return [201, [{ user: { id: 'u1', email: 'a@x.io', inviteAcceptUrl: 'https://n8n/invite/1' } }]];
    });
    await userInviteHandler(env.factory, { role: 'global:member' }, ['a@x.io']);
    expect(body).toEqual([{ email: 'a@x.io', role: 'global:member' }]);
    expect(env.stdout()).toContain('a@x.io');
    expect(process.exitCode).toBeUndefined();
  });

  it('invite sets exit 1 when an entry fails (partial failure)', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPost('/users').reply(201, [
      { user: { id: 'u1', email: 'ok@x.io' } },
      { user: { email: 'dup@x.io' }, error: 'already invited' },
    ]);
    await userInviteHandler(env.factory, {}, ['ok@x.io', 'dup@x.io']);
    expect(process.exitCode).toBe(1);
    expect(env.stderr()).toContain('already invited');
  });

  it('invite rejects an invalid role before any API call', async () => {
    const env = makeFakeFactory();
    await expect(userInviteHandler(env.factory, { role: 'superadmin' }, ['a@x.io'])).rejects.toThrow(
      ValidationError,
    );
  });

  it('user delete → DELETE /users/{id}', async () => {
    const env = makeFakeFactory();
    env.apiMock.onDelete('/users/u1').reply(204);
    await userDeleteHandler(env.factory, {}, ['u1']);
    expect(env.stdout()).toContain('deleted user');
  });

  it('user role → PATCH /users/{id}/role with newRoleName', async () => {
    const env = makeFakeFactory();
    let body: Record<string, unknown> | undefined;
    env.apiMock.onPatch('/users/u1/role').reply((cfg) => {
      body = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [200, {}];
    });
    await userRoleHandler(env.factory, {}, ['u1', 'global:admin']);
    expect(body?.newRoleName).toBe('global:admin');
  });

  it('user role rejects an invalid role', async () => {
    const env = makeFakeFactory();
    await expect(userRoleHandler(env.factory, {}, ['u1', 'root'])).rejects.toThrow(ValidationError);
  });

  it('maps a 403 on invite to a licensed-feature hint', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPost('/users').reply(403, { message: 'forbidden' });
    try {
      await userInviteHandler(env.factory, {}, ['a@x.io']);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).hint).toMatch(/licensed/i);
    }
  });
});

describe('project governance verbs', () => {
  it('create → POST /projects {name}', async () => {
    const env = makeFakeFactory();
    let body: Record<string, unknown> | undefined;
    env.apiMock.onPost('/projects').reply((cfg) => {
      body = JSON.parse(cfg.data as string) as Record<string, unknown>;
      return [201, { id: 'p1', name: 'Team A' }];
    });
    await projectCreateHandler(env.factory, {}, ['Team A']);
    expect(body?.name).toBe('Team A');
    expect(env.stdout()).toContain('p1');
  });

  it('update → PUT /projects/{id}', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPut('/projects/p1').reply(204);
    await projectUpdateHandler(env.factory, {}, ['p1', 'Renamed']);
    expect(env.stdout()).toContain('Renamed');
  });

  it('delete → DELETE /projects/{id}', async () => {
    const env = makeFakeFactory();
    env.apiMock.onDelete('/projects/p1').reply(204);
    await projectDeleteHandler(env.factory, {}, ['p1']);
    expect(env.stdout()).toContain('deleted project');
  });

  it('add-user → POST /projects/{id}/users with relations[]', async () => {
    const env = makeFakeFactory();
    let body: { relations?: Array<{ userId: string; role: string }> } | undefined;
    env.apiMock.onPost('/projects/p1/users').reply((cfg) => {
      body = JSON.parse(cfg.data as string) as typeof body;
      return [201, {}];
    });
    await projectAddUserHandler(env.factory, { role: 'project:editor' }, ['p1', 'u1']);
    expect(body?.relations).toEqual([{ userId: 'u1', role: 'project:editor' }]);
  });

  it('add-user rejects an invalid project role', async () => {
    const env = makeFakeFactory();
    await expect(projectAddUserHandler(env.factory, { role: 'owner' }, ['p1', 'u1'])).rejects.toThrow(
      ValidationError,
    );
  });

  it('remove-user → DELETE /projects/{id}/users/{userId}', async () => {
    const env = makeFakeFactory();
    env.apiMock.onDelete('/projects/p1/users/u1').reply(204);
    await projectRemoveUserHandler(env.factory, {}, ['p1', 'u1']);
    expect(env.stdout()).toContain('removed');
  });

  it('maps 404 on project create to a licensed-feature hint', async () => {
    const env = makeFakeFactory();
    env.apiMock.onPost('/projects').reply(404, { message: 'not found' });
    try {
      await projectCreateHandler(env.factory, {}, ['Team A']);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).hint).toMatch(/licensed/i);
    }
  });

  it('honours --dry-run (no API call)', async () => {
    const env = makeFakeFactory({ dryRun: true });
    let hit = false;
    env.apiMock.onPost('/projects').reply(() => {
      hit = true;
      return [201, {}];
    });
    await projectCreateHandler(env.factory, {}, ['Team A']);
    expect(hit).toBe(false);
    expect(env.stdout()).toContain('[dry-run]');
  });
});
