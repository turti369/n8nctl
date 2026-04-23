import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { updateConfig } from '../../lib/config.js';
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
        const next = await updateConfig((cfg) => {
          if (!cfg.profiles[name]) {
            throw new ValidationError(
              `Profile "${name}" not found`,
              `Available: ${Object.keys(cfg.profiles).join(', ') || '(none)'}`,
            );
          }
          cfg.activeProfile = name;
          return cfg;
        });
        factory.io.stdout.write(
          `${c.green('✓')} switched to profile "${name}" (${next.profiles[name].host})\n`,
        );
      }),
    );
}
