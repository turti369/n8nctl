import { type AxiosInstance, type AxiosRequestConfig, AxiosError } from 'axios';
import { ApiError, NetworkError } from './errors.js';

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
}

/**
 * Retry/backoff transport shared by every n8n HTTP client (Public API,
 * webhook, and the internal /rest session client). Parameterised over an
 * AxiosInstance + a label so each client supplies its own base URL, headers,
 * and auth — the retry policy is identical across all of them.
 *
 * Retries: transient HTTP (429/502/503/504, honouring Retry-After) and
 * transient network errors (ECONNRESET/ETIMEDOUT/...). Non-retryable statuses
 * throw ApiError; exhausted/non-retryable network errors throw NetworkError.
 */
export async function runWithRetry<T>(
  instance: AxiosInstance,
  config: AxiosRequestConfig,
  label: string,
  retry: RetryConfig,
): Promise<T> {
  const { maxRetries, baseBackoffMs, onEvent } = retry;
  const backoff = (a: number): number => baseBackoffMs * Math.pow(2, a);
  let attempt = 0;
  let lastErr: Error | null = null;

  while (attempt <= maxRetries) {
    const startedAt = Date.now();
    onEvent?.({
      event: 'http-request',
      payload: { label, method: config.method?.toUpperCase(), url: config.url, attempt: attempt + 1 },
    });
    try {
      const resp = await instance.request<T>(config);
      const durationMs = Date.now() - startedAt;
      if (process.env.N8NCTL_TRACE === '1') {
        process.stderr.write(
          `[trace] ${label} ${config.method?.toUpperCase()} ${config.url} → ${resp.status} (attempt ${attempt + 1})\n`,
        );
      }
      onEvent?.({
        event: 'http-response',
        payload: {
          label,
          method: config.method?.toUpperCase(),
          url: config.url,
          status: resp.status,
          attempt: attempt + 1,
          durationMs,
        },
      });
      if (resp.status >= 200 && resp.status < 300) {
        return resp.data;
      }

      if (isRetryable(resp.status) && attempt < maxRetries) {
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
        if (isNetworkRetryable(code) && attempt < maxRetries) {
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
