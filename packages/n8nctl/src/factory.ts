import { resolveAuth, resolveSession, type AuthOverrides, type ResolvedAuth, type ResolvedSession } from './lib/auth.js';
import { N8nClient } from './lib/api.js';
import { N8nSessionClient } from './lib/session-api.js';
import { isKeyringAvailable, keyringCookieAccountFor, setPassword } from './lib/keyring.js';
import { createIoStreams, type IoStreams, type LogFormat } from './lib/io.js';
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
}

export function createFactory(flags: GlobalFlags): Factory {
  const io = createIoStreams(flags.logFormat);
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
          timeout: flags.timeout,
          insecure,
          onEvent: (e) => io.event(e.event, e.payload),
        });
      }
      return clientCache;
    },
    sessionClient: async () => {
      if (!sessionClientCache) {
        const s = await ensureSession();
        const insecure = flags.insecure === true || s.insecure === true;
        sessionClientCache = new N8nSessionClient(s, {
          timeout: flags.timeout,
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
