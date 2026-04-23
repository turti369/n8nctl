import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, updateConfig, writeConfig, getConfigPath } from '../src/lib/config.js';
import { ValidationError } from '../src/lib/errors.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-test-'));
  process.env.N8NCTL_CONFIG_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.N8NCTL_CONFIG_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('config: readConfig', () => {
  it('returns default config when file missing', async () => {
    const cfg = await readConfig();
    expect(cfg.activeProfile).toBe('default');
    expect(cfg.profiles).toEqual({});
    expect(cfg.settings?.outputFormat).toBe('auto');
  });

  it('reads existing YAML', async () => {
    await fs.writeFile(
      getConfigPath(),
      'activeProfile: prod\nprofiles:\n  prod:\n    host: https://n8n.example.com\n',
    );
    const cfg = await readConfig();
    expect(cfg.activeProfile).toBe('prod');
    expect(cfg.profiles.prod?.host).toBe('https://n8n.example.com');
  });

  it('merges with default settings when profile block missing settings', async () => {
    await fs.writeFile(getConfigPath(), 'activeProfile: x\nprofiles: {}\n');
    const cfg = await readConfig();
    expect(cfg.settings?.timeout).toBe(30000);
    expect(cfg.settings?.color).toBe('auto');
  });

  it('throws ValidationError on corrupt YAML', async () => {
    await fs.writeFile(getConfigPath(), ':::not valid yaml: {[\n');
    await expect(readConfig()).rejects.toThrow(ValidationError);
  });

  it('returns default when YAML parses to non-object', async () => {
    await fs.writeFile(getConfigPath(), 'just-a-string\n');
    const cfg = await readConfig();
    expect(cfg.activeProfile).toBe('default');
  });
});

describe('config: writeConfig', () => {
  it('creates file with mode 0600 and proper YAML', async () => {
    await writeConfig({
      activeProfile: 'test',
      profiles: {
        test: { host: 'https://x', keyStoredInKeyring: true },
      },
    });
    const raw = await fs.readFile(getConfigPath(), 'utf8');
    expect(raw).toContain('activeProfile: test');
    expect(raw).toContain('host: https://x');
    if (process.platform !== 'win32') {
      const stat = await fs.stat(getConfigPath());
      // eslint-disable-next-line no-bitwise
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });
});

describe('config: updateConfig (atomic)', () => {
  it('applies mutator and persists', async () => {
    const result = await updateConfig((cfg) => {
      cfg.profiles.dev = { host: 'https://dev.example.com' };
      cfg.activeProfile = 'dev';
      return cfg;
    });
    expect(result.profiles.dev?.host).toBe('https://dev.example.com');
    const reread = await readConfig();
    expect(reread.activeProfile).toBe('dev');
  });

  it('serializes concurrent writes — no lost updates', async () => {
    const writes = Array.from({ length: 5 }, (_, i) =>
      updateConfig((cfg) => {
        cfg.profiles[`p${i}`] = { host: `https://h${i}` };
        return cfg;
      }),
    );
    await Promise.all(writes);
    const cfg = await readConfig();
    for (let i = 0; i < 5; i++) {
      expect(cfg.profiles[`p${i}`]?.host).toBe(`https://h${i}`);
    }
  });

  it('propagates mutator error without writing', async () => {
    await writeConfig({ activeProfile: 'pristine', profiles: {} });
    await expect(
      updateConfig(() => {
        throw new Error('mutator boom');
      }),
    ).rejects.toThrow('mutator boom');
    const cfg = await readConfig();
    expect(cfg.activeProfile).toBe('pristine');
  });
});
