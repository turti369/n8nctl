import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ValidationError } from '../src/lib/errors.js';
import type { Factory, GlobalFlags } from '../src/factory.js';
import type { IoStreams } from '../src/lib/io.js';

// Keyring is mocked so these tests never touch the real OS credential store
// (and are deterministic on CI runners without one).
vi.mock('../src/lib/keyring.js', () => ({
  isKeyringAvailable: vi.fn(async () => true),
  setPassword: vi.fn(async () => true),
  getPassword: vi.fn(async () => null),
  purgeProfileSecrets: vi.fn(async () => undefined),
  keyringAccountFor: (p: string) => `key:${p}`,
  keyringCookieAccountFor: (p: string) => `cookie:${p}`,
  keyringPasswordAccountFor: (p: string) => `pw:${p}`,
}));

// N8nClient is stubbed for auth handlers (they construct their own client,
// bypassing the fake factory's mocked instance).
vi.mock('../src/lib/api.js', () => ({
  N8nClient: class {
    async get(): Promise<unknown> {
      return { data: [] };
    }
  },
}));

import { profileAddHandler } from '../src/commands/profile/add.js';
import { profileRemoveHandler } from '../src/commands/profile/remove.js';
import { logoutHandler } from '../src/commands/auth/logout.js';
import { loginHandler } from '../src/commands/auth/login.js';
import { authStatusHandler } from '../src/commands/auth/status.js';
import { readConfig } from '../src/lib/config.js';
import { purgeProfileSecrets, setPassword } from '../src/lib/keyring.js';

/**
 * Minimal in-memory factory. Deliberately NOT makeFakeFactory: this file mocks
 * `lib/api.js` (auth handlers construct their own N8nClient), and the shared
 * fake-factory imports the real N8nClient from that same module — mixing the
 * two would hand the axios mock a stub with no `.http` instance.
 */
function miniFactory(flags: Partial<GlobalFlags> = {}): {
  factory: Factory;
  stdout: () => string;
  stderr: () => string;
} {
  let out = '';
  let err = '';
  const io = {
    stdout: { write: (s: string) => ((out += s), true) },
    stderr: { write: (s: string) => ((err += s), true) },
    isTTY: false,
    isColorEnabled: false,
    logFormat: 'text',
    spinner: (text: string) =>
      ({
        text,
        start() { return this; },
        succeed(t?: string) { err += `${t ?? text}\n`; return this; },
        fail(t?: string) { err += `${t ?? text}\n`; return this; },
        warn(t?: string) { err += `${t ?? text}\n`; return this; },
        stop() { return this; },
      }) as unknown as ReturnType<IoStreams['spinner']>,
    event: (_e: string, _p?: Record<string, unknown>, text?: string) => {
      if (text) err += text.endsWith('\n') ? text : text + '\n';
    },
  } as unknown as IoStreams;
  const factory = {
    io,
    flags: flags as GlobalFlags,
  } as Factory;
  return { factory, stdout: () => out, stderr: () => err };
}

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-prof-'));
  process.env.N8NCTL_CONFIG_DIR = tmpDir;
  delete process.env.N8N_API_KEY;
  delete process.env.N8N_HOST;
  vi.clearAllMocks();
});
afterEach(async () => {
  process.env = { ...savedEnv };
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('profile add / remove', () => {
  it('add writes the profile (host normalized, no trailing slash)', async () => {
    const env = miniFactory();
    await profileAddHandler(env.factory, { host: 'https://n8n.test///' }, ['dev']);
    const cfg = await readConfig();
    expect(cfg.profiles.dev).toEqual({ host: 'https://n8n.test' });
    expect(env.stdout()).toContain('added profile "dev"');
  });

  it('add rejects a non-http host and a duplicate name', async () => {
    const env = miniFactory();
    await expect(profileAddHandler(env.factory, { host: 'n8n.test' }, ['dev'])).rejects.toThrow(
      ValidationError,
    );
    await profileAddHandler(env.factory, { host: 'https://n8n.test' }, ['dev']);
    await expect(
      profileAddHandler(env.factory, { host: 'https://other.test' }, ['dev']),
    ).rejects.toThrow(/already exists/);
  });

  it('remove deletes the profile and purges its secrets (non-TTY: needs --yes semantics skipped)', async () => {
    const env = miniFactory();
    await profileAddHandler(env.factory, { host: 'https://n8n.test' }, ['dev']);
    await profileRemoveHandler(env.factory, { yes: true }, ['dev']);
    const cfg = await readConfig();
    expect(cfg.profiles.dev).toBeUndefined();
    expect(purgeProfileSecrets).toHaveBeenCalledWith('dev');
  });
});

describe('auth logout', () => {
  it('purges secrets, removes the profile, and repoints activeProfile', async () => {
    const env = miniFactory();
    await profileAddHandler(env.factory, { host: 'https://a.test' }, ['a']);
    await profileAddHandler(env.factory, { host: 'https://b.test' }, ['b']);
    await logoutHandler({ ...env.factory, flags: { profile: 'a' } }, {}, []);
    const cfg = await readConfig();
    expect(cfg.profiles.a).toBeUndefined();
    expect(cfg.profiles.b).toBeDefined();
    expect(purgeProfileSecrets).toHaveBeenCalledWith('a');
  });

  it('warns (no throw) for an unknown profile', async () => {
    const env = miniFactory();
    await logoutHandler(env.factory, { profile: 'ghost' }, []);
    expect(env.stderr()).toContain('not found');
  });
});

describe('auth login (non-interactive path)', () => {
  it('verifies credentials, stores the key in the keyring, and writes the profile', async () => {
    const env = miniFactory();
    await loginHandler(
      env.factory,
      { host: 'https://n8n.test', apiKey: 'k-1234567890abcdef', profile: 'ci' },
      [],
    );
    const cfg = await readConfig();
    expect(cfg.profiles.ci).toMatchObject({ host: 'https://n8n.test', keyStoredInKeyring: true });
    expect(cfg.profiles.ci.apiKey).toBeUndefined(); // key lives in the keyring, not the file
    expect(setPassword).toHaveBeenCalledWith('key:ci', 'k-1234567890abcdef');
    expect(env.stdout()).toContain('credentials stored');
  });

  it('--no-keyring stores the key in the config file instead', async () => {
    const env = miniFactory();
    await loginHandler(
      env.factory,
      { host: 'https://n8n.test', apiKey: 'k-1234567890abcdef', profile: 'ci', keyring: false },
      [],
    );
    const cfg = await readConfig();
    expect(cfg.profiles.ci.apiKey).toBe('k-1234567890abcdef');
    expect(cfg.profiles.ci.keyStoredInKeyring).toBe(false);
  });
});

describe('auth status (machine-readable path)', () => {
  it('emits JSON with reachable:true on a non-TTY', async () => {
    const env = miniFactory({ json: true });
    process.env.N8N_HOST = 'https://n8n.test';
    process.env.N8N_API_KEY = 'k-1234567890abcdef';
    await authStatusHandler(env.factory, {}, []);
    const out = JSON.parse(env.stdout()) as Record<string, unknown>;
    expect(out.reachable).toBe(true);
    expect(out.host).toBe('https://n8n.test');
    // key must be masked, never printed in full
    expect(JSON.stringify(out)).not.toContain('k-1234567890abcdef');
  });
});
