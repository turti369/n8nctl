import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig, writeConfig } from '../../lib/config.js';
import { deletePassword, keyringAccountFor } from '../../lib/keyring.js';
import { c } from '../../lib/io.js';

interface LogoutOpts {
  profile?: string;
}

export function createLogoutCommand(): Command {
  return new Command('logout')
    .description('Remove stored credentials for a profile')
    .option('--profile <name>', 'Profile to remove (default: active)')
    .action(
      withAction<LogoutOpts>(async (factory, opts) => {
        const config = await readConfig();
        const name = opts.profile ?? config.activeProfile ?? 'default';
        const profile = config.profiles[name];
        if (!profile) {
          factory.io.stderr.write(`${c.yellow('!')} profile "${name}" not found\n`);
          return;
        }

        if (profile.keyStoredInKeyring) {
          await deletePassword(keyringAccountFor(name));
        }
        delete config.profiles[name];
        if (config.activeProfile === name) {
          config.activeProfile = Object.keys(config.profiles)[0];
        }
        await writeConfig(config);
        factory.io.stdout.write(`${c.green('✓')} logged out of profile "${name}"\n`);
      }),
    );
}
