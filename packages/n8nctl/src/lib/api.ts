import axios, { type AxiosInstance, type AxiosRequestConfig, AxiosError } from 'axios';
import https from 'node:https';
import { ApiError, NetworkError } from './errors.js';
import type { ResolvedAuth } from './auth.js';

export interface ClientOptions {
  timeout?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  insecure?: boolean;
}

export interface PageIterator<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export interface WebhookRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

const USER_AGENT = 'n8nctl/0.2.0';

export class N8nClient {
  private readonly http: AxiosInstance;
  private readonly webhookHttp: AxiosInstance;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  readonly host: string;

  constructor(auth: ResolvedAuth, opts: ClientOptions = {}) {
    this.host = auth.host;
    const httpsAgent = opts.insecure
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

    const commonDefaults = {
      timeout: opts.timeout ?? 30000,
      validateStatus: () => true,
      httpsAgent,
    };

    this.http = axios.create({
      ...commonDefaults,
      baseURL: `${auth.host}/api/v1`,
      headers: {
        'X-N8N-API-KEY': auth.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    // Webhook requests go to a different base (/webhook/* or /webhook-test/*)
    // and must NOT carry X-N8N-API-KEY (webhook auth is independent of the
    // Public API key — each webhook node has its own auth configuration).
    this.webhookHttp = axios.create({
      ...commonDefaults,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': USER_AGENT,
      },
    });
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 500;
  }

  async *paginate<T>(
    url: string,
    params: Record<string, unknown> = {},
  ): AsyncGenerator<T, void, unknown> {
    let cursor: string | null | undefined = undefined;
    do {
      const query: Record<string, unknown> = { ...params };
      if (cursor) query.cursor = cursor;
      const resp = await this.get<{ data: T[]; nextCursor?: string | null }>(url, query);
      for (const item of resp.data) yield item;
      cursor = resp.nextCursor ?? null;
    } while (cursor);
  }

  async request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
    return this.runWithRetry<T>(this.http, config, 'n8n API');
  }

  /**
   * POST to a workflow's webhook URL, sharing the retry/backoff/insecure
   * infrastructure of the main API client. Webhook auth is independent of
   * the n8n Public API key, so custom headers (Bearer, Basic, per-header
   * auth) are supplied per call.
   */
  async webhookRequest<T = unknown>(url: string, data: unknown, opts: WebhookRequestOptions = {}): Promise<T> {
    return this.runWithRetry<T>(
      this.webhookHttp,
      {
        method: opts.method ?? 'POST',
        url,
        data,
        headers: opts.headers,
        timeout: opts.timeout,
      },
      'webhook',
    );
  }

  private async runWithRetry<T>(
    instance: AxiosInstance,
    config: AxiosRequestConfig,
    label: string,
  ): Promise<T> {
    let attempt = 0;
    let lastErr: Error | null = null;

    while (attempt <= this.maxRetries) {
      try {
        const resp = await instance.request<T>(config);
        if (process.env.N8NCTL_TRACE === '1') {
          process.stderr.write(
            `[trace] ${label} ${config.method?.toUpperCase()} ${config.url} → ${resp.status} (attempt ${attempt + 1})\n`,
          );
        }
        if (resp.status >= 200 && resp.status < 300) {
          return resp.data;
        }

        if (isRetryable(resp.status) && attempt < this.maxRetries) {
          const retryAfter = parseRetryAfter(resp.headers['retry-after']);
          await sleep(retryAfter ?? this.backoff(attempt));
          attempt++;
          continue;
        }

        throw new ApiError(
          `${label} returned ${resp.status} ${resp.statusText}`,
          resp.status,
          resp.data,
          this.statusHint(resp.status),
        );
      } catch (err) {
        if (err instanceof ApiError) throw err;

        if (err instanceof AxiosError) {
          const code = err.code ?? 'UNKNOWN';
          if (isNetworkRetryable(code) && attempt < this.maxRetries) {
            await sleep(this.backoff(attempt));
            attempt++;
            lastErr = err;
            continue;
          }
          throw new NetworkError(`${label} request failed: ${err.message} (${code})`);
        }

        throw err;
      }
    }

    throw new NetworkError(`Exceeded ${this.maxRetries} retries: ${lastErr?.message ?? 'unknown'}`);
  }

  private backoff(attempt: number): number {
    return this.baseBackoffMs * Math.pow(2, attempt);
  }

  private statusHint(status: number): string | undefined {
    if (status === 401) return 'Run `n8nctl auth status` and re-authenticate if needed.';
    if (status === 403) return 'API key lacks required permissions.';
    if (status === 404) return 'Resource not found — verify the ID.';
    if (status === 429) return 'Rate limited by n8n. The CLI retried automatically.';
    if (status >= 500) return 'n8n server error. Check n8n instance logs.';
    return undefined;
  }

  get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>({ method: 'GET', url, params });
  }
  post<T = unknown>(url: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', url, data: body });
  }
  put<T = unknown>(url: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PUT', url, data: body });
  }
  patch<T = unknown>(url: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PATCH', url, data: body });
  }
  delete<T = unknown>(url: string): Promise<T> {
    return this.request<T>({ method: 'DELETE', url });
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isNetworkRetryable(code: string): boolean {
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH', 'EAI_AGAIN'].includes(code);
}

function parseRetryAfter(header: string | number | string[] | undefined): number | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : String(header);
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
