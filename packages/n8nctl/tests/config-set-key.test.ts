import { describe, it, expect } from 'vitest';
import { applyConfigKey } from '../src/commands/config/set.js';
import { ValidationError } from '../src/lib/errors.js';

describe('applyConfigKey', () => {
  it('sets a top-level key', () => {
    const cfg: Record<string, unknown> = { profiles: {} };
    applyConfigKey(cfg, 'activeProfile', 'prod');
    expect(cfg.activeProfile).toBe('prod');
  });

  it('sets a nested key, creating intermediate objects', () => {
    const cfg: Record<string, unknown> = {};
    applyConfigKey(cfg, 'settings.outputFormat', 'json');
    expect((cfg.settings as Record<string, unknown>).outputFormat).toBe('json');
  });

  it('preserves sibling keys when setting nested values', () => {
    const cfg: Record<string, unknown> = { settings: { color: 'auto' } };
    applyConfigKey(cfg, 'settings.timeout', 5000);
    expect(cfg.settings).toEqual({ color: 'auto', timeout: 5000 });
  });

  // Structural guard: key paths must never traverse into the prototype chain,
  // even if a future ALLOWED_KEYS entry contains a dangerous segment.
  it.each(['__proto__.polluted', 'constructor.prototype.polluted', 'settings.__proto__.x', 'prototype.x'])(
    'rejects prototype-chain segment in "%s"',
    (key) => {
      const cfg: Record<string, unknown> = {};
      expect(() => applyConfigKey(cfg, key, 'evil')).toThrow(ValidationError);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );
});
