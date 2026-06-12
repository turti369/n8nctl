import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig } from '../../lib/config.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

export async function profileListHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const config = await readConfig();
  const entries = Object.entries(config.profiles).map(([name, p]) => ({
    name,
    host: p.host,
    active: name === config.activeProfile,
    keyring: Boolean(p.keyStoredInKeyring),
  }));

  if (entries.length === 0) {
    factory.io.stderr.write(
      `${c.yellow('no profiles')} — run \`n8nctl auth login\` to add one\n`,
    );
    return;
  }

  await printData(entries, { io: factory.io, opts: factory.flags }, (d) => {
    const rows = (d as typeof entries).map((e) => [
      e.active ? c.green('*') : ' ',
      e.name,
      e.host,
      e.keyring ? 'keyring' : 'config',
    ]);
    return { head: ['', 'NAME', 'HOST', 'STORAGE'], rows };
  });
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List configured profiles')
    .action(withAction(profileListHandler));
}
