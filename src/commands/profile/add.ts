import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig, writeConfig } from '../../lib/config.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';

interface AddOpts {
  host: string;
}

export function createAddCommand(): Command {
  return new Command('add')
    .description('Add a new profile (credentials added via `n8nctl auth login --profile <name>`)')
    .argument('<name>', 'profile name (dev, staging, prod, ...)')
    .requiredOption('--host <url>', 'n8n host URL')
    .action(
      withAction<AddOpts>(async (factory, opts, args) => {
        const [name] = args;
        if (!/^https?:\/\//.test(opts.host)) {
          throw new ValidationError('Host must start with http:// or https://');
        }
        const config = await readConfig();
        if (config.profiles[name]) {
          throw new ValidationError(`Profile "${name}" already exists`);
        }
        config.profiles[name] = { host: opts.host.replace(/\/+$/, '') };
        await writeConfig(config);
        factory.io.stdout.write(
          `${c.green('✓')} added profile "${name}" — next: ${c.cyan(`n8nctl auth login --profile ${name}`)}\n`,
        );
      }),
    );
}
