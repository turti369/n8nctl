import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { ValidationError } from './errors.js';

export interface Profile {
  host: string;
  keyStoredInKeyring?: boolean;
  apiKey?: string;
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

export async function writeConfig(config: ConfigFile): Promise<void> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });
  const yamlStr = yaml.dump(config, { indent: 2, lineWidth: 120, sortKeys: false });
  await fs.writeFile(getConfigPath(), yamlStr, { mode: 0o600 });
}

export async function getActiveProfile(profileOverride?: string): Promise<{ name: string; profile: Profile } | null> {
  const config = await readConfig();
  const name = profileOverride ?? config.activeProfile ?? 'default';
  const profile = config.profiles[name];
  if (!profile) return null;
  return { name, profile };
}
