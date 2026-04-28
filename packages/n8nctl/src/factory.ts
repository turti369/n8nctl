import { resolveAuth, type AuthOverrides, type ResolvedAuth } from './lib/auth.js';
import { N8nClient } from './lib/api.js';
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
}

export function createFactory(flags: GlobalFlags): Factory {
  const io = createIoStreams(flags.logFormat);
  let authCache: ResolvedAuth | null = null;
  let clientCache: N8nClient | null = null;

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

  return {
    io,
    flags,
    auth: ensureAuth,
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
  };
}
