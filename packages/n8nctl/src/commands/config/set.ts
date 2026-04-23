import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { updateConfig } from '../../lib/config.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';

const ALLOWED_KEYS: Record<string, (v: string) => unknown> = {
  'activeProfile': (v) => v,
  'settings.outputFormat': (v) => {
    if (!['auto', 'json', 'table'].includes(v)) throw new Error('must be auto|json|table');
    return v;
  },
  'settings.color': (v) => {
    if (!['auto', 'always', 'never'].includes(v)) throw new Error('must be auto|always|never');
    return v;
  },
  'settings.timeout': (v) => {
    const n = Number(v);
    if (Number.isNaN(n) || n < 1000) throw new Error('must be a number >= 1000 (ms)');
    return n;
  },
};

export function createSetCommand(): Command {
  return new Command('set')
    .description('Set a config value')
    .argument('<key>', `Config key (one of: ${Object.keys(ALLOWED_KEYS).join(', ')})`)
    .argument('<value>', 'New value')
    .action(
      withAction(async (factory, _opts, args) => {
        const [key, rawValue] = args;
        const parser = ALLOWED_KEYS[key];
        if (!parser) {
          throw new ValidationError(
            `Unknown config key "${key}"`,
            `Allowed: ${Object.keys(ALLOWED_KEYS).join(', ')}`,
          );
        }

        let value: unknown;
        try {
          value = parser(rawValue);
        } catch (e) {
          throw new ValidationError(`Invalid value for "${key}": ${(e as Error).message}`);
        }

        await updateConfig((cfg) => {
          const parts = key.split('.');
          if (parts.length === 1) {
            (cfg as unknown as Record<string, unknown>)[parts[0]] = value;
            return cfg;
          }
          const last = parts[parts.length - 1];
          const parent = parts.slice(0, -1).reduce<Record<string, unknown>>(
            (acc, p) => {
              if (!acc[p] || typeof acc[p] !== 'object') acc[p] = {};
              return acc[p] as Record<string, unknown>;
            },
            cfg as unknown as Record<string, unknown>,
          );
          parent[last] = value;
          return cfg;
        });

        factory.io.stdout.write(`${c.green('✓')} ${key} = ${JSON.stringify(value)}\n`);
      }),
    );
}
