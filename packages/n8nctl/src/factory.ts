import { resolveAuth, resolveSession, type AuthOverrides, type ResolvedAuth, type ResolvedSession } from './lib/auth.js';
import { N8nClient } from './lib/api.js';
import { N8nSessionClient } from './lib/session-api.js';
import { isKeyringAvailable, keyringCookieAccountFor, setPassword } from './lib/keyring.js';
import { createIoStreams, type IoStreams, type LogFormat } from './lib/io.js';
import { readConfigSync } from './lib/config.js';
import type { OutputOptions } from './lib/output.js';

export interface GlobalFlags extends AuthOverrides, OutputOptions {
  timeout?: number;
  insecure?: boolean;
  dryRun?: boolean;
  logFormat?: LogFormat;
}

export interface Factory {
  io: IoStreams;
  flags: GlobalFlags;
  auth: () => Promise<ResolvedAuth>;
  client: () => Promise<N8nClient>;
  /** Resolve internal-/rest session credentials (for `workflow run`). */
  session: () => Promise<ResolvedSession>;
  /** Lazy session client for /rest endpoints the Public API can't reach. */
  sessionClient: () => Promise<N8nSessionClient>;
  /**
   * Build a Public-API client for a DIFFERENT named profile (for cross-
   * instance commands like `workflow promote --to <profile>`). Resolves auth
   * for that profile independently; honors --insecure/--timeout.
   */
  clientForProfile: (profile: string) => Promise<N8nClient>;
}

export function createFactory(flags: GlobalFlags): Factory {
  // Wire config `settings` (flag/env > config > default), respecting contract §2/§6.
  const settings = readConfigSync().settings ?? {};
  const io = createIoStreams(flags.logFormat, settings.color);
  // Timeout: explicit --timeout flag wins, then settings.timeout, then the
  // client's own 30000 default (via `?? undefined`).
  const resolvedTimeout = flags.timeout ?? settings.timeout;
  // Output format: an explicit --json/--jq/--template still wins inside
  // printData; settings.outputFormat only sets the TTY default when no such
  // flag and no explicit override are present.
  if (flags.outputFormat === undefined && settings.outputFormat) {
    flags.outputFormat = settings.outputFormat;
  }
  let authCache: ResolvedAuth | null = null;
  let clientCache: N8nClient | null = null;
  let sessionCache: ResolvedSession | null = null;
  let sessionClientCache: N8nSessionClient | null = null;

  const ensureAuth = async () => {
    if (!authCache) {
      authCache = await resolveAuth({
        apiKey: flags.apiKey,
        host: flags.host,
        profile: flags.profile,
      });
    }
    return authCache;
  };

  const ensureSession = async () => {
    if (!sessionCache) {
      sessionCache = await resolveSession({ host: flags.host, profile: flags.profile });
    }
    return sessionCache;
  };

  return {
    io,
    flags,
    auth: ensureAuth,
    session: ensureSession,
    client: async () => {
      if (!clientCache) {
        const a = await ensureAuth();
        const insecure = flags.insecure === true || a.insecure === true;
        if (insecure) {
          io.event(
            'tls-verification-disabled',
            { level: 'warn', host: a.host },
            '\x1b[33mwarning\x1b[0m: TLS verification disabled',
          );
        }
        clientCache = new N8nClient(a, {
          timeout: resolvedTimeout,
          insecure,
          onEvent: (e) => io.event(e.event, e.payload),
        });
      }
      return clientCache;
    },
    clientForProfile: async (profile: string) => {
      const a = await resolveAuth({ profile });
      const insecure = flags.insecure === true || a.insecure === true;
      return new N8nClient(a, {
        timeout: resolvedTimeout,
        insecure,
        onEvent: (e) => io.event(e.event, e.payload),
      });
    },
    sessionClient: async () => {
      if (!sessionClientCache) {
        const s = await ensureSession();
        const insecure = flags.insecure === true || s.insecure === true;
        sessionClientCache = new N8nSessionClient(s, {
          timeout: resolvedTimeout,
          insecure,
          onEvent: (e) => io.event(e.event, e.payload),
          onCookie: async (cookie) => {
            // Cache the fresh cookie so later CLI invocations skip re-login.
            if (await isKeyringAvailable()) {
              await setPassword(keyringCookieAccountFor(s.profileName), cookie);
            }
          },
        });
      }
      return sessionClientCache;
    },
  };
}
