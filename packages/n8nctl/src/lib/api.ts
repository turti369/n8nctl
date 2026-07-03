import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import https from 'node:https';
import { runWithRetry, type ClientEvent } from './transport.js';
import { USER_AGENT } from './version.js';
import type { ResolvedAuth } from './auth.js';

export type { ClientEvent } from './transport.js';

export interface ClientOptions {
  timeout?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  insecure?: boolean;
  /**
   * Called for every HTTP attempt (success, retry, final failure). Used to
   * surface request lifecycle as structured events (NDJSON mode) without
   * coupling the client to a specific logger.
   */
  onEvent?: (e: ClientEvent) => void;
}

export interface PageIterator<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export interface WebhookRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export class N8nClient {
  private readonly http: AxiosInstance;
  private readonly webhookHttp: AxiosInstance;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly onEvent?: (e: ClientEvent) => void;
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
    this.onEvent = opts.onEvent;
  }

  private get retryConfig() {
    return { maxRetries: this.maxRetries, baseBackoffMs: this.baseBackoffMs, onEvent: this.onEvent };
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
    return runWithRetry<T>(this.http, config, 'n8n API', this.retryConfig);
  }

  /**
   * Single GET that exposes response HEADERS (server version, rate-limit).
   * Goes through the same axios instance as every other call so it inherits
   * auth, timeout, --insecure, and the real User-Agent — used by `doctor
   * --verbose`, which previously bypassed all of that with a bare fetch().
   */
  async probeHeaders(
    url: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, string>> {
    const resp = await this.http.request({ method: 'GET', url, params });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(resp.headers ?? {})) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    return headers;
  }

  /**
   * POST to a workflow's webhook URL, sharing the retry/backoff/insecure
   * infrastructure of the main API client. Webhook auth is independent of
   * the n8n Public API key, so custom headers (Bearer, Basic, per-header
   * auth) are supplied per call.
   */
  async webhookRequest<T = unknown>(url: string, data: unknown, opts: WebhookRequestOptions = {}): Promise<T> {
    return runWithRetry<T>(
      this.webhookHttp,
      {
        method: opts.method ?? 'POST',
        url,
        data,
        headers: opts.headers,
        timeout: opts.timeout,
      },
      'webhook',
      // Data-plane: the target workflow can return 429/5xx AFTER running its
      // side effects, so no HTTP-status retry — only connection-never-established
      // network errors are retried.
      { ...this.retryConfig, dataPlane: true },
    );
  }

  /**
   * Single-shot webhook request that exposes the EXACT response status.
   * Deliberately no retry: --expect-status gates need the true status, and a
   * retried POST can double-fire the workflow. Non-2xx does NOT throw —
   * callers compare the status themselves.
   */
  async webhookProbe(
    url: string,
    data: unknown,
    opts: WebhookRequestOptions = {},
  ): Promise<{ status: number; body: unknown }> {
    this.onEvent?.({
      event: 'http-request',
      payload: { label: 'webhook-probe', method: opts.method ?? 'POST', url, attempt: 1 },
    });
    const resp = await this.webhookHttp.request({
      method: opts.method ?? 'POST',
      url,
      data,
      headers: opts.headers,
      timeout: opts.timeout,
    });
    this.onEvent?.({
      event: 'http-response',
      payload: { label: 'webhook-probe', method: opts.method ?? 'POST', url, status: resp.status, attempt: 1 },
    });
    return { status: resp.status, body: resp.data };
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
