import { describe, it, expect } from 'vitest';
import { applyProfileHostPrecedence } from '../src/lib/runtime.js';
import type { GlobalFlags } from '../src/factory.js';

/**
 * Regression for the live-found bug: with N8N_HOST exported in the shell,
 * commander binds it to --host, so `--profile docker-target` sent the docker
 * key to the prod host → 401. A named profile must be self-contained.
 */
describe('applyProfileHostPrecedence', () => {
  it('drops env-sourced host when --profile is explicit (the 401 bug)', () => {
    const flags: GlobalFlags = { profile: 'docker', host: 'https://prod.from.env' };
    applyProfileHostPrecedence(flags, { profile: 'cli', host: 'env', apiKey: 'default' });
    expect(flags.host).toBeUndefined(); // profile host will be used downstream
  });

  it('keeps an explicit --host even with --profile', () => {
    const flags: GlobalFlags = { profile: 'docker', host: 'https://explicit' };
    applyProfileHostPrecedence(flags, { profile: 'cli', host: 'cli', apiKey: 'default' });
    expect(flags.host).toBe('https://explicit');
  });

  it('also drops env-sourced apiKey under an explicit profile', () => {
    const flags: GlobalFlags = { profile: 'docker', apiKey: 'env-key', host: 'h' };
    applyProfileHostPrecedence(flags, { profile: 'cli', host: 'cli', apiKey: 'env' });
    expect(flags.apiKey).toBeUndefined();
  });

  it('does nothing when profile is not CLI-sourced (env-only flow preserved)', () => {
    const flags: GlobalFlags = { host: 'https://env-host', apiKey: 'env-key' };
    applyProfileHostPrecedence(flags, { profile: 'default', host: 'env', apiKey: 'env' });
    expect(flags.host).toBe('https://env-host');
    expect(flags.apiKey).toBe('env-key');
  });
});
