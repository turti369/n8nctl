/**
 * Redaction for workflow and execution payloads.
 *
 * Removes sensitive identifiers and cached data that could leak through
 * stdout when piped to logs, shared in bug reports, or committed to git.
 *
 * What we redact:
 *   - pinData (entire field → cached API responses, may contain user PII)
 *   - credentials.<type>.name (credential display name)
 *   - webhookId (internal routing UUID — paired with webhook node path)
 *   - nodes[].webhookId  (set on webhook/trigger nodes)
 *
 * What we KEEP (safe — already tokens for referencing, not values):
 *   - credentials.<type>.id (foreign key to credential record)
 *   - node ids, positions, typeVersions, parameters (non-sensitive)
 *
 * What we DON'T scan for:
 *   - Secrets embedded in parameters (Bearer tokens, API keys) — if user
 *     hardcoded those, the validator Layer 4 catches them.
 */

const REDACT_MARKER = '[REDACTED]';

export function redactWorkflow<T>(input: T): T {
  if (input === null || input === undefined) return input;
  return deepRedact(input) as T;
}

function deepRedact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'pinData') {
        out[k] = REDACT_MARKER;
        continue;
      }
      if (k === 'webhookId') {
        out[k] = REDACT_MARKER;
        continue;
      }
      if (k === 'credentials' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = redactCredentials(v as Record<string, unknown>);
        continue;
      }
      out[k] = deepRedact(v);
    }
    return out;
  }
  return value;
}

function redactCredentials(creds: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [type, ref] of Object.entries(creds)) {
    if (ref !== null && typeof ref === 'object' && !Array.isArray(ref)) {
      const r = ref as Record<string, unknown>;
      out[type] = {
        ...r,
        name: REDACT_MARKER,
      };
    } else {
      out[type] = ref;
    }
  }
  return out;
}
