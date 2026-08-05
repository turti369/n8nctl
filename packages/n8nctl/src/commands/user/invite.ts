import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { rethrowWithLicenseHint } from '../../lib/license.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

const GLOBAL_ROLES = ['global:admin', 'global:member'] as const;

interface InviteOpts {
  role?: string;
}

interface InviteResultEntry {
  user?: { id?: string; email?: string; inviteAcceptUrl?: string };
  error?: string;
}

export async function userInviteHandler(
  factory: Factory,
  opts: InviteOpts,
  args: string[],
): Promise<void> {
  const emails = args.filter(Boolean);
  const role = opts.role ?? 'global:member';
  if (!GLOBAL_ROLES.includes(role as (typeof GLOBAL_ROLES)[number])) {
    throw new ValidationError(`Invalid role "${role}"`, `Pick one of: ${GLOBAL_ROLES.join(', ')}`);
  }

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would invite ${emails.length} user(s) as ${role}: ${emails.join(', ')}\n`,
    );
    return;
  }

  const client = await factory.client();
  let results: InviteResultEntry[];
  try {
    // The invite endpoint takes an ARRAY and reports success/failure per entry.
    results = await client.post<InviteResultEntry[]>(
      '/users',
      emails.map((email) => ({ email, role })),
    );
  } catch (err) {
    rethrowWithLicenseHint(err, 'User management');
  }

  const rows = (Array.isArray(results) ? results : []).map((r) => ({
    email: r.user?.email ?? '(unknown)',
    id: r.user?.id ?? null,
    inviteAcceptUrl: r.user?.inviteAcceptUrl ?? null,
    error: r.error ?? null,
  }));
  const failed = rows.filter((r) => r.error);
  for (const r of rows) {
    factory.io.event(
      'user-invited',
      { email: r.email, id: r.id, error: r.error },
      r.error
        ? `${c.red('✗')} ${r.email}: ${r.error}`
        : `${c.green('✓')} invited ${r.email}${r.inviteAcceptUrl ? ` — ${r.inviteAcceptUrl}` : ''}`,
    );
  }
  await printData(rows, { io: factory.io, opts: factory.flags });
  if (failed.length > 0) process.exitCode = 1;
}

export function createInviteCommand(): Command {
  return new Command('invite')
    .description('Invite one or more users by email (licensed: user management)')
    .argument('<emails...>', 'email address(es) to invite')
    .option('--role <role>', `global role for the invitees (${GLOBAL_ROLES.join(' | ')})`, 'global:member')
    .action(withAction<InviteOpts>(userInviteHandler));
}
