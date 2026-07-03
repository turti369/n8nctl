import { type AxiosInstance, type AxiosRequestConfig, AxiosError } from 'axios';
import { ApiError, NetworkError } from './errors.js';
import { sleep } from './util.js';

/**
 * Structured lifecycle event for a single HTTP attempt. Emitted for every
 * request/response/retry/error so callers can surface NDJSON without coupling
 * the transport to a logger.
 */
export interface ClientEvent {
  event: 'http-request' | 'http-response' | 'http-retry' | 'http-error';
  payload: Record<string, unknown>;
}

export interface RetryConfig {
  maxRetries: number;
  baseBackoffMs: number;
  onEvent?: (e: ClientEvent) => void;
  /**
   * Data-plane (webhook) request: the TARGET workflow can legitimately return
   * 429/5xx AFTER running its side effects, so a retry would re-fire it. When
   * true, NO HTTP-status retry happens regardless of method — only network
   * errors where the connection was never established are retried (the request
   * provably never reached n8n). Default false = control-plane Public/`/rest`
   * API, where retry is method-aware (see isRetryableStatus).
   */
  dataPlane?: boolean;
}

/**
 * Retry/backoff transport shared by every n8n HTTP client (Public API,
 * webhook, and the internal /rest session client). Parameterised over an
 * AxiosInstance + a label so each client supplies its own base URL, headers,
 * and auth.
 *
 * Retry policy is METHOD-AWARE to avoid duplicating a resource/side effect
 * when a write times out *after* n8n committed it:
 *  - Idempotent methods (GET/HEAD/PUT/DELETE): retry all transient HTTP
 *    (429/502/503/504, honouring Retry-After) and all transient network errors.
 *  - Non-idempotent methods (POST/PATCH): retry ONLY when the server provably
 *    did not process the request — HTTP 429 (rejected before handling) and
 *    connection-never-established network errors (ECONNREFUSED/ENETUNREACH/
 *    EAI_AGAIN). Ambiguous failures (502/504/ECONNRESET/ETIMEDOUT) are NOT
 *    retried for POST/PATCH — surfaced as an error instead of risking a double
 *    write. This is the same reasoning webhookProbe already applied.
 *  - Data-plane (webhook): no HTTP-status retry at all (see RetryConfig.dataPlane).
 *
 * Caveat: a retried idempotent DELETE/PUT that already succeeded server-side
 * before an ambiguous 5xx may return 404/409 on the retry — surfaced as an
 * ApiError even though the intended effect happened. Callers of DELETE/PUT
 * that gate on exact status should account for this.
 *
 * Non-retryable statuses throw ApiError; exhausted/non-retryable network errors
 * throw NetworkError.
 */
export async function runWithRetry<T>(
  instance: AxiosInstance,
  config: AxiosRequestConfig,
  label: string,
  retry: RetryConfig,
): Promise<T> {
  const { maxRetries, baseBackoffMs, onEvent, dataPlane = false } = retry;
  const backoff = (a: number): number => baseBackoffMs * Math.pow(2, a);
  // axios leaves method undefined when unset and defaults to GET — mirror that
  // so the idempotency classification never sees an undefined method.
  const method = (config.method ?? 'GET').toUpperCase();
  let attempt = 0;
  let lastErr: Error | null = null;

  while (attempt <= maxRetries) {
    const startedAt = Date.now();
    onEvent?.({
      event: 'http-request',
      payload: { label, method, url: config.url, attempt: attempt + 1 },
    });
    try {
      const resp = await instance.request<T>(config);
      const durationMs = Date.now() - startedAt;
      if (process.env.N8NCTL_TRACE === '1') {
        process.stderr.write(
          `[trace] ${label} ${method} ${config.url} → ${resp.status} (attempt ${attempt + 1})\n`,
        );
      }
      onEvent?.({
        event: 'http-response',
        payload: {
          label,
          method,
          url: config.url,
          status: resp.status,
          attempt: attempt + 1,
          durationMs,
        },
      });
      if (resp.status >= 200 && resp.status < 300) {
        return resp.data;
      }

      if (isRetryableStatus(resp.status, method, dataPlane) && attempt < maxRetries) {
        const retryAfter = parseRetryAfter(resp.headers['retry-after']);
        const waitMs = retryAfter ?? backoff(attempt);
        onEvent?.({
          event: 'http-retry',
          payload: { label, status: resp.status, attempt: attempt + 1, waitMs, level: 'warn' },
        });
        await sleep(waitMs);
        attempt++;
        continue;
      }

      throw new ApiError(
        `${label} returned ${resp.status} ${resp.statusText}`,
        resp.status,
        resp.data,
        statusHint(resp.status),
      );
    } catch (err) {
      if (err instanceof ApiError) {
        onEvent?.({
          event: 'http-error',
          payload: { label, status: err.status, message: err.message, level: 'error' },
        });
        throw err;
      }

      if (err instanceof AxiosError) {
        const code = err.code ?? 'UNKNOWN';
        if (isNetworkRetryable(code, method, dataPlane) && attempt < maxRetries) {
          onEvent?.({
            event: 'http-retry',
            payload: { label, code, attempt: attempt + 1, level: 'warn' },
          });
          await sleep(backoff(attempt));
          attempt++;
          lastErr = err;
          continue;
        }
        onEvent?.({
          event: 'http-error',
          payload: { label, code, message: err.message, level: 'error' },
        });
        throw new NetworkError(`${label} request failed: ${err.message} (${code})`);
      }

      throw err;
    }
  }

  throw new NetworkError(`Exceeded ${maxRetries} retries: ${lastErr?.message ?? 'unknown'}`);
}

export function statusHint(status: number): string | undefined {
  if (status === 401) return 'Run `n8nctl auth status` and re-authenticate if needed.';
  if (status === 403) return 'API key lacks required permissions.';
  if (status === 404) return 'Resource not found — verify the ID.';
  if (status === 429) return 'Rate limited by n8n. The CLI retried automatically.';
  if (status >= 500) return 'n8n server error. Check n8n instance logs.';
  return undefined;
}

/** Methods safe to retry unconditionally — the effect is the same if repeated. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

/** Network failures where the connection was never established → the request
 *  provably never reached the server, so retrying is safe for ANY method. */
const CONNECTION_NEVER_ESTABLISHED = new Set(['ECONNREFUSED', 'ENETUNREACH', 'EAI_AGAIN']);

/** Network failures where the request MAY have reached the server (ambiguous):
 *  safe to retry only for idempotent methods on the control plane. */
const AMBIGUOUS_NETWORK = new Set(['ECONNRESET', 'ETIMEDOUT']);

const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

function isRetryableStatus(status: number, method: string, dataPlane: boolean): boolean {
  if (!TRANSIENT_STATUS.has(status)) return false;
  // Data-plane (webhook): never retry on an HTTP status — the workflow may have
  // already run and returned 429/5xx itself.
  if (dataPlane) return false;
  if (IDEMPOTENT_METHODS.has(method)) return true;
  // Non-idempotent (POST/PATCH): only 429 is provably pre-handling rejection.
  return status === 429;
}

function isNetworkRetryable(code: string, method: string, dataPlane: boolean): boolean {
  if (CONNECTION_NEVER_ESTABLISHED.has(code)) return true;
  if (!AMBIGUOUS_NETWORK.has(code)) return false;
  // Ambiguous: request may have reached the server. Data-plane never retries;
  // control-plane retries only idempotent methods.
  if (dataPlane) return false;
  return IDEMPOTENT_METHODS.has(method);
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

