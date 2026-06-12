import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { updateConfig } from '../../lib/config.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

interface AddOpts {
  host: string;
  insecure?: boolean;
}

export async function profileAddHandler(
  factory: Factory,
  opts: AddOpts,
  args: string[],
): Promise<void> {
  const [name] = args;
  if (!/^https?:\/\//.test(opts.host)) {
    throw new ValidationError('Host must start with http:// or https://');
  }
  await updateConfig((cfg) => {
    if (cfg.profiles[name]) {
      throw new ValidationError(`Profile "${name}" already exists`);
    }
    cfg.profiles[name] = {
      host: opts.host.replace(/\/+$/, ''),
      ...(opts.insecure ? { insecure: true } : {}),
    };
    return cfg;
  });
  factory.io.stdout.write(
    `${c.green('✓')} added profile "${name}" — next: ${c.cyan(`n8nctl auth login --profile ${name}`)}\n`,
  );
}

export function createAddCommand(): Command {
  return new Command('add')
    .description('Add a new profile (credentials added via `n8nctl auth login --profile <name>`)')
    .argument('<name>', 'profile name (dev, staging, prod, ...)')
    .requiredOption('--host <url>', 'n8n host URL')
    .option('--insecure', 'Store profile with TLS verification disabled (dev instances only)')
    .action(withAction<AddOpts>(profileAddHandler));
}
