import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { updateConfig } from '../../lib/config.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

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

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Apply a dot-path config key to a config object. Exported for tests.
 * Rejects prototype-chain segments structurally so a future ALLOWED_KEYS
 * entry can never be turned into prototype pollution.
 */
export function applyConfigKey(
  cfg: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const parts = key.split('.');
  for (const p of parts) {
    if (FORBIDDEN_SEGMENTS.has(p)) {
      throw new ValidationError(`Config key segment "${p}" is not allowed`);
    }
  }
  if (parts.length === 1) {
    cfg[parts[0]] = value;
    return;
  }
  const last = parts[parts.length - 1];
  const parent = parts.slice(0, -1).reduce<Record<string, unknown>>((acc, p) => {
    if (!acc[p] || typeof acc[p] !== 'object') acc[p] = {};
    return acc[p] as Record<string, unknown>;
  }, cfg);
  parent[last] = value;
}

export async function configSetHandler(
  factory: Factory,
  _opts: unknown,
  args: string[],
): Promise<void> {
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
    applyConfigKey(cfg as unknown as Record<string, unknown>, key, value);
    return cfg;
  });

  factory.io.stdout.write(`${c.green('✓')} ${key} = ${JSON.stringify(value)}\n`);
}

export function createSetCommand(): Command {
  return new Command('set')
    .description('Set a config value')
    .argument('<key>', `Config key (one of: ${Object.keys(ALLOWED_KEYS).join(', ')})`)
    .argument('<value>', 'New value')
    .action(withAction(configSetHandler));
}
