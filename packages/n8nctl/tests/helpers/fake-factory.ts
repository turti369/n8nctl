import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { N8nClient } from '../../src/lib/api.js';
import { N8nSessionClient } from '../../src/lib/session-api.js';
import type { Factory, GlobalFlags } from '../../src/factory.js';
import type { IoStreams, LogFormat, StructuredEvent } from '../../src/lib/io.js';
import type { ResolvedAuth, ResolvedSession } from '../../src/lib/auth.js';

const TEST_AUTH: ResolvedAuth = {
  host: 'https://test.example.com',
  apiKey: 'test-key',
  profileName: 'test',
  source: 'flag',
};

const TEST_SESSION: ResolvedSession = {
  host: 'https://test.example.com',
  email: 'a@b.com',
  password: 'pw',
  profileName: 'test',
};

export interface CapturedEvent {
  event: string;
  payload: Record<string, unknown>;
  text?: string;
}

export interface FakeFactory {
  factory: Factory;
  /** Mock the Public API (/api/v1) HTTP layer. */
  apiMock: MockAdapter;
  /** Mock the webhook HTTP layer (trigger-webhook command). */
  webhookMock: MockAdapter;
  /** Mock the internal /rest session HTTP layer (lazily created on first sessionClient()). */
  sessionMock: () => MockAdapter;
  stdout: () => string;
  stderr: () => string;
  events: CapturedEvent[];
}

/**
 * In-memory Factory for command-handler tests. Captures stdout/stderr and the
 * NDJSON event stream (the agent contract) instead of writing to real streams,
 * and backs client()/sessionClient() with axios-mock-adapter so handlers run
 * end-to-end without a live n8n.
 */
export function makeFakeFactory(flags: Partial<GlobalFlags> = {}): FakeFactory {
  let out = '';
  let err = '';
  const events: CapturedEvent[] = [];

  const logFormat: LogFormat = flags.logFormat ?? 'text';

  const write = (target: 'out' | 'err', s: string): boolean => {
    if (target === 'out') out += s;
    else err += s;
    return true;
  };

  const io: IoStreams = {
    stdout: { write: (s: string) => write('out', s) } as unknown as NodeJS.WriteStream,
    stderr: { write: (s: string) => write('err', s) } as unknown as NodeJS.ReadStream & NodeJS.WriteStream,
    stdin: { } as NodeJS.ReadStream,
    isTTY: false,
    isColorEnabled: false,
    logFormat,
    spinner: (text: string) =>
      ({
        text,
        start() { return this; },
        succeed(t?: string) { write('err', `${t ?? text}\n`); return this; },
        fail(t?: string) { write('err', `${t ?? text}\n`); return this; },
        warn(t?: string) { write('err', `${t ?? text}\n`); return this; },
        stop() { return this; },
      }) as unknown as ReturnType<IoStreams['spinner']>,
    event: (eventName, payload = {}, text) => {
      events.push({ event: eventName, payload, text });
      if (logFormat === 'ndjson') {
        const record: StructuredEvent = {
          ts: new Date().toISOString(),
          level: (payload.level as StructuredEvent['level']) ?? 'info',
          event: eventName,
          ...payload,
        };
        write('err', JSON.stringify(record) + '\n');
      } else if (text) {
        write('err', text.endsWith('\n') ? text : text + '\n');
      }
    },
  };

  const client = new N8nClient(TEST_AUTH, { baseBackoffMs: 1, timeout: 1000 });
  const apiMock = new MockAdapter((client as unknown as { http: axios.AxiosInstance }).http);
  const webhookMock = new MockAdapter(
    (client as unknown as { webhookHttp: axios.AxiosInstance }).webhookHttp,
  );

  let sessionClient: N8nSessionClient | null = null;
  let sessionMockAdapter: MockAdapter | null = null;
  const ensureSessionClient = (): N8nSessionClient => {
    if (!sessionClient) {
      sessionClient = new N8nSessionClient(TEST_SESSION, {});
      sessionMockAdapter = new MockAdapter(
        (sessionClient as unknown as { http: axios.AxiosInstance }).http,
      );
      // Default: login succeeds so handlers don't have to wire it every time.
      sessionMockAdapter.onPost('/login').reply(200, { data: { email: 'a@b.com' } }, {
        'set-cookie': ['n8n-auth=tok; Path=/; HttpOnly'],
      });
    }
    return sessionClient;
  };

  const factory: Factory = {
    io,
    flags: flags as GlobalFlags,
    auth: async () => TEST_AUTH,
    session: async () => TEST_SESSION,
    client: async () => client,
    sessionClient: async () => ensureSessionClient(),
  };

  return {
    factory,
    apiMock,
    webhookMock,
    sessionMock: () => {
      ensureSessionClient();
      return sessionMockAdapter as MockAdapter;
    },
    stdout: () => out,
    stderr: () => err,
    events,
  };
}
