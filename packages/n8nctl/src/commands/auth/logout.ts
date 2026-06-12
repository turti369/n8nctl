import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig, updateConfig } from '../../lib/config.js';
import { purgeProfileSecrets } from '../../lib/keyring.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

interface LogoutOpts {
  profile?: string;
}

export async function logoutHandler(
  factory: Factory,
  opts: LogoutOpts,
  _args: string[],
): Promise<void> {
  const config = await readConfig();
  // Honor both the subcommand --profile and the global --profile flag.
  const name = opts.profile ?? factory.flags.profile ?? config.activeProfile ?? 'default';
  const profile = config.profiles[name];
  if (!profile) {
    factory.io.stderr.write(`${c.yellow('!')} profile "${name}" not found\n`);
    return;
  }

  // Purge ALL secrets (api-key + session password + cookie) so a session
  // profile never leaves reusable login creds behind.
  await purgeProfileSecrets(name);

  await updateConfig((cfg) => {
    delete cfg.profiles[name];
    if (cfg.activeProfile === name) {
      cfg.activeProfile = Object.keys(cfg.profiles)[0];
    }
    return cfg;
  });

  factory.io.stdout.write(`${c.green('✓')} logged out of profile "${name}"\n`);
}

export function createLogoutCommand(): Command {
  return new Command('logout')
    .description('Remove stored credentials for a profile')
    .option('--profile <name>', 'Profile to remove (default: active)')
    .action(withAction<LogoutOpts>(logoutHandler));
}
