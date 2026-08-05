import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { resolveAuth } from '../../lib/auth.js';
import { N8nClient } from '../../lib/api.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

export async function authStatusHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const auth = await resolveAuth({
    apiKey: factory.flags.apiKey,
    host: factory.flags.host,
    profile: factory.flags.profile,
  });

  const base = {
    profile: auth.profileName,
    host: auth.host,
    source: auth.source,
    apiKey: maskKey(auth.apiKey),
  };

  // Machine-readable (contract §2): --json/--jq/--template or non-TTY → JSON.
  const wantsMachine =
    Boolean(factory.flags.json) ||
    Boolean(factory.flags.jq) ||
    Boolean(factory.flags.template) ||
    !factory.io.isTTY;

  if (wantsMachine) {
    const client = new N8nClient(auth);
    try {
      await client.get('/workflows', { limit: 1 });
      await printData({ ...base, reachable: true }, { io: factory.io, opts: factory.flags });
    } catch (err) {
      await printData(
        { ...base, reachable: false, error: (err as Error).message },
        { io: factory.io, opts: factory.flags },
      );
      throw err; // preserve the non-zero exit code
    }
    return;
  }

  factory.io.stdout.write(`${c.bold('Profile:')} ${auth.profileName}\n`);
  factory.io.stdout.write(`${c.bold('Host:')}    ${auth.host}\n`);
  factory.io.stdout.write(`${c.bold('Source:')}  ${auth.source}\n`);
  factory.io.stdout.write(`${c.bold('API key:')} ${maskKey(auth.apiKey)}\n\n`);

  const spinner = factory.io.spinner('Pinging n8n...').start();
  try {
    const client = new N8nClient(auth);
    await client.get('/workflows', { limit: 1 });
    spinner.succeed(`${c.green('authenticated')} — API reachable`);
  } catch (err) {
    spinner.fail(`${c.red('failed')}: ${(err as Error).message}`);
    throw err;
  }
}

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show active authentication and verify connectivity')
    .action(withAction(authStatusHandler));
}

function maskKey(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '...' + key.slice(-4);
}
