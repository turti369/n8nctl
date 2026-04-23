import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig } from '../../lib/config.js';
import { ValidationError } from '../../lib/errors.js';

const ALLOWED_KEYS = ['activeProfile', 'settings.outputFormat', 'settings.color', 'settings.timeout'];

export function createGetCommand(): Command {
  return new Command('get')
    .description('Get a config value')
    .argument('<key>', `Config key (one of: ${ALLOWED_KEYS.join(', ')})`)
    .action(
      withAction(async (factory, _opts, args) => {
        const [key] = args;
        if (!ALLOWED_KEYS.includes(key)) {
          throw new ValidationError(
            `Unknown config key "${key}"`,
            `Allowed: ${ALLOWED_KEYS.join(', ')}`,
          );
        }
        const config = await readConfig();
        const value = resolvePath(config as unknown as Record<string, unknown>, key);
        factory.io.stdout.write(value === undefined ? '' : String(value));
        factory.io.stdout.write('\n');
      }),
    );
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}
