import { AuthError } from './errors.js';
import { getActiveProfile, readConfig, type Profile } from './config.js';
import { getPassword, isKeyringAvailable, keyringAccountFor } from './keyring.js';

export interface ResolvedAuth {
  host: string;
  apiKey: string;
  profileName: string;
  source: 'flag' | 'env' | 'keyring' | 'config';
}

export interface AuthOverrides {
  apiKey?: string;
  host?: string;
  profile?: string;
}

export async function resolveAuth(overrides: AuthOverrides = {}): Promise<ResolvedAuth> {
  // Tier 1: explicit --api-key + --host flags
  if (overrides.apiKey && overrides.host) {
    return {
      host: stripTrailingSlash(overrides.host),
      apiKey: overrides.apiKey,
      profileName: overrides.profile ?? 'flag',
      source: 'flag',
    };
  }

  // Tier 2: env vars (backwards compat with existing n8n-api skill)
  const envKey = process.env.N8N_API_KEY;
  const envHost = process.env.N8N_HOST;
  if (!overrides.profile && envKey && envHost) {
    return {
      host: stripTrailingSlash(envHost),
      apiKey: envKey,
      profileName: 'env',
      source: 'env',
    };
  }

  // Tier 3 + 4: profile (active or overridden) — read host from config, key from keyring or config
  const active = await getActiveProfile(overrides.profile);
  if (!active) {
    const config = await readConfig();
    const profileList = Object.keys(config.profiles);
    throw new AuthError(
      `No credentials configured${overrides.profile ? ` for profile "${overrides.profile}"` : ''}.`,
      profileList.length > 0
        ? `Available profiles: ${profileList.join(', ')}. Use --profile <name> or set N8N_API_KEY + N8N_HOST.`
        : 'Run `n8nctl auth login` to configure, or set N8N_API_KEY + N8N_HOST env vars.',
    );
  }

  const host = overrides.host ?? active.profile.host;
  if (!host) {
    throw new AuthError(`Profile "${active.name}" has no host configured.`);
  }

  const apiKey = await readApiKey(active.name, active.profile);
  if (!apiKey) {
    throw new AuthError(
      `No API key found for profile "${active.name}".`,
      'Run `n8nctl auth login` to store a key in the OS keyring.',
    );
  }

  return {
    host: stripTrailingSlash(host),
    apiKey,
    profileName: active.name,
    source: active.profile.keyStoredInKeyring ? 'keyring' : 'config',
  };
}

async function readApiKey(profileName: string, profile: Profile): Promise<string | null> {
  if (profile.keyStoredInKeyring && (await isKeyringAvailable())) {
    const fromKeyring = await getPassword(keyringAccountFor(profileName));
    if (fromKeyring) return fromKeyring;
  }
  return profile.apiKey ?? null;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}
