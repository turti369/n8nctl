import { resolveAuth, type AuthOverrides, type ResolvedAuth } from './lib/auth.js';
import { N8nClient } from './lib/api.js';
import { createIoStreams, type IoStreams } from './lib/io.js';
import type { OutputOptions } from './lib/output.js';

export interface GlobalFlags extends AuthOverrides, OutputOptions {
  timeout?: number;
}

export interface Factory {
  io: IoStreams;
  flags: GlobalFlags;
  auth: () => Promise<ResolvedAuth>;
  client: () => Promise<N8nClient>;
}

export function createFactory(flags: GlobalFlags): Factory {
  const io = createIoStreams();
  let authCache: ResolvedAuth | null = null;
  let clientCache: N8nClient | null = null;

  return {
    io,
    flags,
    auth: async () => {
      if (!authCache) {
        authCache = await resolveAuth({
          apiKey: flags.apiKey,
          host: flags.host,
          profile: flags.profile,
        });
      }
      return authCache;
    },
    client: async () => {
      if (!clientCache) {
        const a = await (async () => {
          if (!authCache) {
            authCache = await resolveAuth({
              apiKey: flags.apiKey,
              host: flags.host,
              profile: flags.profile,
            });
          }
          return authCache;
        })();
        clientCache = new N8nClient(a, { timeout: flags.timeout });
      }
      return clientCache;
    },
  };
}
