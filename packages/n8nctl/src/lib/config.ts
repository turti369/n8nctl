import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import lockfile from 'proper-lockfile';
import { ValidationError } from './errors.js';

export interface SessionConfig {
  /** n8n UI login email for /rest session auth. */
  email: string;
  /** True if the login password is in the OS keyring (vs not stored — cookie-only). */
  passwordInKeyring?: boolean;
  /** Cookie-only mode: never store the password; re-prompt on cookie expiry. */
  cookieOnly?: boolean;
}

export interface Profile {
  host: string;
  keyStoredInKeyring?: boolean;
  apiKey?: string;
  insecure?: boolean;
  /** Which auth methods this profile holds. API key for reads, session for run. */
  authMethods?: Array<'api-key' | 'session'>;
  /** Internal /rest session-mode credentials (for `workflow run`). */
  session?: SessionConfig;
}

export interface ConfigFile {
  activeProfile?: string;
  profiles: Record<string, Profile>;
  settings?: {
    outputFormat?: 'auto' | 'json' | 'table';
    color?: 'auto' | 'always' | 'never';
    timeout?: number;
  };
}

const DEFAULT_CONFIG: ConfigFile = {
  activeProfile: 'default',
  profiles: {},
  settings: {
    outputFormat: 'auto',
    color: 'auto',
    timeout: 30000,
  },
};

export function getConfigDir(): string {
  if (process.env.N8NCTL_CONFIG_DIR) return process.env.N8NCTL_CONFIG_DIR;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'n8nctl');
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(xdg, 'n8nctl');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.yml');
}

export async function readConfig(): Promise<ConfigFile> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = yaml.load(raw) as Partial<ConfigFile> | null;
    if (!parsed || typeof parsed !== 'object') {
      return structuredClone(DEFAULT_CONFIG);
    }
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      profiles: parsed.profiles ?? {},
      settings: { ...DEFAULT_CONFIG.settings, ...(parsed.settings ?? {}) },
    };
  } catch (err) {
    throw new ValidationError(
      `Failed to read config at ${configPath}: ${(err as Error).message}`,
      'Check YAML syntax or delete the file to start fresh.',
    );
  }
}

/**
 * Synchronous config read for construction-time settings wiring (color +
 * timeout defaults must be resolved before any async work / first output).
 * Deliberately RESILIENT: a malformed config returns defaults rather than
 * throwing, so a bad YAML file can never crash startup at exit 5 before the
 * error path runs. The async `readConfig` still surfaces YAML errors on the
 * auth path (exit 3). Only the `settings` block is consumed from this.
 */
export function readConfigSync(): ConfigFile {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return structuredClone(DEFAULT_CONFIG);
  try {
    const parsed = yaml.load(readFileSync(configPath, 'utf8')) as Partial<ConfigFile> | null;
    if (!parsed || typeof parsed !== 'object') return structuredClone(DEFAULT_CONFIG);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      profiles: parsed.profiles ?? {},
      settings: { ...DEFAULT_CONFIG.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export async function writeConfig(config: ConfigFile): Promise<void> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    await fs.writeFile(configPath, '', { mode: 0o600 });
  }

  const release = await lockfile.lock(configPath, {
    retries: { retries: 5, factor: 1.5, minTimeout: 100, maxTimeout: 1000 },
    stale: 10000,
  });
  try {
    const yamlStr = yaml.dump(config, { indent: 2, lineWidth: 120, sortKeys: false });
    await fs.writeFile(configPath, yamlStr, { mode: 0o600 });
  } finally {
    await release();
  }
}

export async function updateConfig(
  mutator: (config: ConfigFile) => ConfigFile | Promise<ConfigFile>,
): Promise<ConfigFile> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    await fs.writeFile(configPath, '', { mode: 0o600 });
  }
  const release = await lockfile.lock(configPath, {
    retries: { retries: 5, factor: 1.5, minTimeout: 100, maxTimeout: 1000 },
    stale: 10000,
  });
  try {
    const current = await readConfig();
    const next = await mutator(current);
    const yamlStr = yaml.dump(next, { indent: 2, lineWidth: 120, sortKeys: false });
    await fs.writeFile(configPath, yamlStr, { mode: 0o600 });
    return next;
  } finally {
    await release();
  }
}

export async function getActiveProfile(profileOverride?: string): Promise<{ name: string; profile: Profile } | null> {
  const config = await readConfig();
  const name = profileOverride ?? config.activeProfile ?? 'default';
  const profile = config.profiles[name];
  if (!profile) return null;
  return { name, profile };
}
