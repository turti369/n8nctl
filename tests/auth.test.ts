import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveAuth } from '../src/lib/auth.js';
import { AuthError } from '../src/lib/errors.js';

vi.mock('../src/lib/config.js', () => ({
  readConfig: vi.fn(),
  getActiveProfile: vi.fn(),
}));
vi.mock('../src/lib/keyring.js', () => ({
  isKeyringAvailable: vi.fn().mockResolvedValue(false),
  getPassword: vi.fn().mockResolvedValue(null),
  keyringAccountFor: (n: string) => `profile:${n}`,
}));

const configMod = await import('../src/lib/config.js');
const readConfig = vi.mocked(configMod.readConfig);
const getActiveProfile = vi.mocked(configMod.getActiveProfile);

describe('resolveAuth', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.N8N_API_KEY;
    delete process.env.N8N_HOST;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('uses --api-key + --host flags when both supplied', async () => {
    const auth = await resolveAuth({ apiKey: 'flagkey', host: 'https://flag.example.com/' });
    expect(auth.source).toBe('flag');
    expect(auth.apiKey).toBe('flagkey');
    expect(auth.host).toBe('https://flag.example.com'); // trailing slash stripped
  });

  it('falls back to env vars', async () => {
    process.env.N8N_API_KEY = 'envkey';
    process.env.N8N_HOST = 'https://env.example.com';
    const auth = await resolveAuth({});
    expect(auth.source).toBe('env');
    expect(auth.apiKey).toBe('envkey');
  });

  it('uses profile from config when no flags/env', async () => {
    getActiveProfile.mockResolvedValue({
      name: 'default',
      profile: { host: 'https://cfg.example.com', apiKey: 'cfgkey' },
    });
    const auth = await resolveAuth({});
    expect(auth.source).toBe('config');
    expect(auth.host).toBe('https://cfg.example.com');
  });

  it('throws AuthError when no credentials anywhere', async () => {
    getActiveProfile.mockResolvedValue(null);
    readConfig.mockResolvedValue({ profiles: {}, activeProfile: 'default' });
    await expect(resolveAuth({})).rejects.toThrow(AuthError);
  });

  it('throws AuthError with hint listing profiles when override is unknown', async () => {
    getActiveProfile.mockResolvedValue(null);
    readConfig.mockResolvedValue({
      profiles: {
        dev: { host: 'https://dev' },
        prod: { host: 'https://prod' },
      },
    });
    await expect(resolveAuth({ profile: 'staging' })).rejects.toMatchObject({
      name: 'AuthError',
      hint: expect.stringContaining('dev, prod'),
    });
  });
});
