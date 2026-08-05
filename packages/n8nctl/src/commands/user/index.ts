import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { createInviteCommand } from './invite.js';
import { createDeleteCommand } from './delete.js';
import { createRoleCommand } from './role.js';
import type { Factory } from '../../factory.js';

interface N8nUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  isPending?: boolean;
}

export async function userListHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const client = await factory.client();
  const users: N8nUser[] = [];
  for await (const u of client.paginate<N8nUser>('/users', { limit: 100 })) {
    users.push(u);
  }
  await printData(users, { io: factory.io, opts: factory.flags }, (d) => {
    const rows = (d as N8nUser[]).map((u) => [
      u.id,
      u.email ?? '',
      [u.firstName, u.lastName].filter(Boolean).join(' '),
      u.role ?? '',
      u.isPending ? 'pending' : 'active',
    ]);
    return { head: ['ID', 'EMAIL', 'NAME', 'ROLE', 'STATUS'], rows };
  });
}

export async function userGetHandler(
  factory: Factory,
  _opts: unknown,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();
  const user = await client.get<N8nUser>(`/users/${encodeURIComponent(id)}`);
  await printData(user, { io: factory.io, opts: factory.flags });
}

export function createUserCommand(): Command {
  const cmd = new Command('user').description('Manage instance users (writes are licensed features)');
  cmd.addCommand(
    new Command('list').alias('ls').description('List users').action(withAction(userListHandler)),
  );
  cmd.addCommand(
    new Command('get')
      .description('Get a user by id or email')
      .argument('<id>', 'user id or email')
      .action(withAction(userGetHandler)),
  );
  cmd.addCommand(createInviteCommand());
  cmd.addCommand(createDeleteCommand());
  cmd.addCommand(createRoleCommand());
  return cmd;
}
