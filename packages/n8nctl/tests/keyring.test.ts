import { describe, it, expect, vi, beforeEach } from 'vitest';

// The keyring module lazy-loads keytar. We replace the import with a mock
// that we control per-test so we can simulate: module missing, setPassword
// throwing, setPassword silently failing (Linux without libsecret), etc.
vi.mock('keytar', () => {
  return {
    default: {
      setPassword: vi.fn(),
      getPassword: vi.fn(),
      deletePassword: vi.fn(),
    },
  };
});

let keytar: {
  setPassword: ReturnType<typeof vi.fn>;
  getPassword: ReturnType<typeof vi.fn>;
  deletePassword: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  // Force re-import of keyring.ts so its module-level keytarCache resets.
  vi.resetModules();
  const mod = (await import('keytar')).default;
  keytar = mod as unknown as typeof keytar;
  keytar.setPassword.mockReset();
  keytar.getPassword.mockReset();
  keytar.deletePassword.mockReset();
});

describe('keyring: isKeyringAvailable', () => {
  it('returns true when keytar loaded', async () => {
    const { isKeyringAvailable } = await import('../src/lib/keyring.js');
    expect(await isKeyringAvailable()).toBe(true);
  });
});

describe('keyring: setPassword — verify-after-write', () => {
  it('returns true when set+get round-trip matches', async () => {
    keytar.setPassword.mockResolvedValue(undefined);
    keytar.getPassword.mockResolvedValue('my-secret');
    const { setPassword } = await import('../src/lib/keyring.js');
    expect(await setPassword('profile:default', 'my-secret')).toBe(true);
  });

  it('returns FALSE when setPassword succeeds but getPassword returns null (libsecret missing)', async () => {
    keytar.setPassword.mockResolvedValue(undefined);
    keytar.getPassword.mockResolvedValue(null);
    const { setPassword } = await import('../src/lib/keyring.js');
    expect(await setPassword('profile:default', 'x')).toBe(false);
  });

  it('returns FALSE when round-trip value differs', async () => {
    keytar.setPassword.mockResolvedValue(undefined);
    keytar.getPassword.mockResolvedValue('different');
    const { setPassword } = await import('../src/lib/keyring.js');
    expect(await setPassword('profile:default', 'original')).toBe(false);
  });

  it('returns FALSE when setPassword throws', async () => {
    keytar.setPassword.mockRejectedValue(new Error('broken'));
    const { setPassword } = await import('../src/lib/keyring.js');
    expect(await setPassword('profile:default', 'x')).toBe(false);
  });
});

describe('keyring: getPassword', () => {
  it('returns stored password', async () => {
    keytar.getPassword.mockResolvedValue('secret');
    const { getPassword } = await import('../src/lib/keyring.js');
    expect(await getPassword('profile:default')).toBe('secret');
  });

  it('returns null on error', async () => {
    keytar.getPassword.mockRejectedValue(new Error('fail'));
    const { getPassword } = await import('../src/lib/keyring.js');
    expect(await getPassword('profile:default')).toBeNull();
  });

  it('returns null when no password stored', async () => {
    keytar.getPassword.mockResolvedValue(null);
    const { getPassword } = await import('../src/lib/keyring.js');
    expect(await getPassword('profile:default')).toBeNull();
  });
});

describe('keyring: deletePassword', () => {
  it('returns true on successful delete', async () => {
    keytar.deletePassword.mockResolvedValue(true);
    const { deletePassword } = await import('../src/lib/keyring.js');
    expect(await deletePassword('profile:default')).toBe(true);
  });

  it('returns false when delete throws', async () => {
    keytar.deletePassword.mockRejectedValue(new Error('fail'));
    const { deletePassword } = await import('../src/lib/keyring.js');
    expect(await deletePassword('profile:default')).toBe(false);
  });
});

describe('keyring: keyringAccountFor', () => {
  it('prefixes profile name', async () => {
    const { keyringAccountFor } = await import('../src/lib/keyring.js');
    expect(keyringAccountFor('prod')).toBe('profile:prod');
    expect(keyringAccountFor('dev')).toBe('profile:dev');
  });
});
