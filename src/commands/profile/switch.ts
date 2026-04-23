import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig, writeConfig } from '../../lib/config.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';

export function createSwitchCommand(): Command {
  return new Command('switch')
    .alias('use')
    .description('Set the active profile')
    .argument('<name>', 'profile name')
    .action(
      withAction(async (factory, _opts, args) => {
        const [name] = args;
        const config = await readConfig();
        if (!config.profiles[name]) {
          throw new ValidationError(
            `Profile "${name}" not found`,
            `Available: ${Object.keys(config.profiles).join(', ') || '(none)'}`,
          );
        }
        config.activeProfile = name;
        await writeConfig(config);
        factory.io.stdout.write(
          `${c.green('✓')} switched to profile "${name}" (${config.profiles[name].host})\n`,
        );
      }),
    );
}
