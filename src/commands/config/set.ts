import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig, writeConfig } from '../../lib/config.js';
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

        const config = await readConfig();
        const parts = key.split('.');
        const target = parts.length === 1
          ? (config as unknown as Record<string, unknown>)
          : (() => {
              const last = parts[parts.length - 1];
              const parent = parts.slice(0, -1).reduce<Record<string, unknown>>(
                (acc, p) => {
                  if (!acc[p] || typeof acc[p] !== 'object') acc[p] = {};
                  return acc[p] as Record<string, unknown>;
                },
                config as unknown as Record<string, unknown>,
              );
              return { parent, last };
            })();

        if (parts.length === 1) {
          (target as Record<string, unknown>)[parts[0]] = value;
        } else {
          const { parent, last } = target as { parent: Record<string, unknown>; last: string };
          parent[last] = value;
        }

        await writeConfig(config);
        factory.io.stdout.write(`${c.green('✓')} ${key} = ${JSON.stringify(value)}\n`);
      }),
    );
}
