/**
 * Redaction for EXECUTION payloads (runtime IO): HTTP responses, headers,
 * decrypted credential values flowing through nodes. Complements
 * redactWorkflow (redact.ts), which only handles workflow STRUCTURE and
 * explicitly does not scan runtime values.
 *
 * Default-on for `execution logs --io-data`, `trigger-webhook --capture`,
 * and `workflow verify --capture`; bypass with --unsafe-raw-io.
 */

const REDACT_MARKER = '[REDACTED]';

/** Key names that hold secrets regardless of value shape. */
const SECRET_KEY_RE =
  /^(authorization|proxy-authorization|x-n8n-api-key|api[-_]?key|apikey|token|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|client[-_]?secret|password|passwd|pwd|cookie|set-cookie|session|private[-_]?key|credentials?)$/i;

/** Value shapes that are secrets wherever they appear inside strings. */
const SECRET_VALUE_RES: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, // JWT
  /sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /npm_[A-Za-z0-9]{20,}/g,
  /AIza[A-Za-z0-9_-]{20,}/g,
  /(?:r|s)k_live_[A-Za-z0-9]{16,}/g,
];

function scrubString(value: string): string {
  let out = value;
  for (const re of SECRET_VALUE_RES) {
    out = out.replace(re, REDACT_MARKER);
  }
  return out;
}

function walk(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map(walk);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? REDACT_MARKER : walk(v);
    }
    return out;
  }
  return value;
}

export function redactExecutionData<T>(input: T): T {
  return walk(input) as T;
}
