import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig, getConfigPath } from '../../lib/config.js';
import { c } from '../../lib/io.js';
import yaml from 'js-yaml';

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('Show all config values')
    .action(
      withAction(async (factory) => {
        const config = await readConfig();
        factory.io.stdout.write(`${c.dim(`# ${getConfigPath()}`)}\n`);
        // Mask API keys stored in config (not recommended)
        const redacted = structuredClone(config);
        for (const [name, p] of Object.entries(redacted.profiles)) {
          if (p.apiKey) redacted.profiles[name] = { ...p, apiKey: '***redacted***' };
        }
        factory.io.stdout.write(yaml.dump(redacted, { indent: 2 }));
      }),
    );
}
