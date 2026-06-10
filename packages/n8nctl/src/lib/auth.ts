import { AuthError } from './errors.js';
import { getActiveProfile, readConfig, type Profile } from './config.js';
import {
  getPassword,
  isKeyringAvailable,
  keyringAccountFor,
  keyringCookieAccountFor,
  keyringPasswordAccountFor,
} from './keyring.js';

export interface ResolvedAuth {
  host: string;
  apiKey: string;
  profileName: string;
  source: 'flag' | 'env' | 'keyring' | 'config';
  insecure?: boolean;
}

export interface AuthOverrides {
  apiKey?: string;
  host?: string;
  profile?: string;
}

/**
 * Resolved internal-/rest session credentials, used by `workflow run` to hit
 * `POST /rest/workflows/{id}/run` (the UI "Execute Workflow" endpoint) which
 * the Public API cannot reach. Kept SEPARATE from ResolvedAuth so the API-key
 * path stays unchanged (apiKey remains required there).
 */
export interface ResolvedSession {
  host: string;
  email: string;
  /** Present when stored in keyring or supplied via env; absent in cookie-only after expiry. */
  password?: string;
  /** Cached session cookie ("n8n-auth=...") if available — saves a re-login. */
  cookie?: string;
  /** True if no password is stored — client must re-prompt/fail on cookie expiry. */
  cookieOnly?: boolean;
  profileName: string;
  insecure?: boolean;
}

export interface SessionOverrides {
  host?: string;
  profile?: string;
  email?: string;
  password?: string;
}

/**
 * Resolve session credentials, precedence: explicit overrides → env
 * (N8N_EMAIL + N8N_PASSWORD + N8N_HOST) → active profile's `session` block
 * (password from keyring, cookie cached). Throws AuthError when nothing
 * resolves. Never returns/throws the password value in messages.
 */
export async function resolveSession(overrides: SessionOverrides = {}): Promise<ResolvedSession> {
  // Tier 1: explicit overrides (flags)
  const envEmail = process.env.N8N_EMAIL;
  const envPassword = process.env.N8N_PASSWORD;
  const envHost = process.env.N8N_HOST;

  const email = overrides.email ?? (!overrides.profile ? envEmail : undefined);
  const password = overrides.password ?? (!overrides.profile ? envPassword : undefined);
  const hostFromFlagEnv = overrides.host ?? (!overrides.profile ? envHost : undefined);

  if (email && hostFromFlagEnv) {
    return {
      host: stripTrailingSlash(hostFromFlagEnv),
      email,
      password,
      profileName: overrides.profile ?? 'env',
      cookieOnly: !password,
    };
  }

  // Tier 2: active profile session block
  const active = await getActiveProfile(overrides.profile);
  if (!active || !active.profile.session) {
    throw new AuthError(
      `No session credentials configured${overrides.profile ? ` for profile "${overrides.profile}"` : ''}.`,
      'Run `n8nctl auth login --session` to configure email/password for `workflow run`, ' +
        'or set N8N_EMAIL + N8N_PASSWORD + N8N_HOST env vars.',
    );
  }

  const host = overrides.host ?? active.profile.host;
  if (!host) throw new AuthError(`Profile "${active.name}" has no host configured.`);

  const sess = active.profile.session;
  let resolvedPassword = password;
  if (!resolvedPassword && sess.passwordInKeyring && (await isKeyringAvailable())) {
    resolvedPassword = (await getPassword(keyringPasswordAccountFor(active.name))) ?? undefined;
  }
  let cookie: string | undefined;
  if (await isKeyringAvailable()) {
    cookie = (await getPassword(keyringCookieAccountFor(active.name))) ?? undefined;
  }

  if (!resolvedPassword && !cookie) {
    throw new AuthError(
      `No session password or cached cookie for profile "${active.name}".`,
      sess.cookieOnly
        ? 'Cookie-only profile and cookie is missing/expired — run `n8nctl auth login --session` again.'
        : 'Run `n8nctl auth login --session` to store credentials.',
    );
  }

  return {
    host: stripTrailingSlash(host),
    email: sess.email,
    password: resolvedPassword,
    cookie,
    cookieOnly: sess.cookieOnly,
    profileName: active.name,
    insecure: active.profile.insecure,
  };
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
    insecure: active.profile.insecure,
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
