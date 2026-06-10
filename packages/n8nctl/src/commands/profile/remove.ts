import { Command } from 'commander';
import inquirer from 'inquirer';
import { withAction } from '../../lib/runtime.js';
import { readConfig, updateConfig } from '../../lib/config.js';
import { purgeProfileSecrets } from '../../lib/keyring.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';

interface RemoveOpts {
  yes?: boolean;
}

export function createRemoveCommand(): Command {
  return new Command('remove')
    .alias('rm')
    .description('Remove a profile (and its stored credentials)')
    .argument('<name>', 'profile name')
    .option('-y, --yes', 'Skip confirmation')
    .action(
      withAction<RemoveOpts>(async (factory, opts, args) => {
        const [name] = args;
        const config = await readConfig();
        const profile = config.profiles[name];
        if (!profile) {
          throw new ValidationError(`Profile "${name}" not found`);
        }

        if (!opts.yes && factory.io.isTTY) {
          const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Remove profile "${name}" (${profile.host})?`,
              default: false,
            },
          ]);
          if (!confirm) {
            factory.io.stderr.write(`${c.yellow('cancelled')}\n`);
            return;
          }
        }

        // Purge ALL secrets (api-key + session password + cookie).
        await purgeProfileSecrets(name);
        await updateConfig((cfg) => {
          delete cfg.profiles[name];
          if (cfg.activeProfile === name) {
            cfg.activeProfile = Object.keys(cfg.profiles)[0];
          }
          return cfg;
        });
        factory.io.stdout.write(`${c.green('✓')} removed profile "${name}"\n`);
      }),
    );
}
