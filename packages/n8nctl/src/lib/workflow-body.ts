import type { Workflow } from '../types/n8n.js';

/**
 * n8n Public API POST /workflows and PUT /workflows/{id} accept a strict
 * whitelist of exactly four fields. Sending ANY extra field (server-managed,
 * client-cache, internal-runtime) makes n8n return HTTP 400.
 *
 * Allowed:
 *   - name, nodes, connections, settings
 *
 * Rejected (must be dropped before send):
 *   - id, createdAt, updatedAt, versionId → server-generated
 *   - active → use activate/deactivate endpoints
 *   - tags → use PUT /workflows/{id}/tags endpoint
 *   - pinData → client-side test fixture cache
 *   - staticData → server-side runtime state, not part of definition
 *   - meta → server-side template/marketplace metadata
 *   - …and any future field n8n adds — whitelist is forward-safe.
 *
 * History: pre-0.4.1 this was a blacklist of 6 fields, which let pinData /
 * staticData / meta through and triggered 400s on workflows backed up after
 * a manual test run (pinData populated). Switched to whitelist in 0.4.1.
 */
const ALLOWED_API_FIELDS = ['name', 'nodes', 'connections', 'settings'] as const;

export function stripReadOnlyFields(wf: Partial<Workflow>): Partial<Workflow> {
  const out: Partial<Workflow> = {};
  for (const key of ALLOWED_API_FIELDS) {
    if (key in wf && wf[key] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[key] = wf[key];
    }
  }
  return out;
}

/**
 * For large payloads (AI workflows with embedded RAG data, big pinData),
 * 30s default axios timeout on slow networks (3G, VPN, overseas link) is
 * often too short. Extend proportionally to payload size, capped at 3min.
 *
 * Returns the suggested timeout in ms, or undefined if the default is fine.
 */
export function suggestTimeout(bodyBytes: number, userTimeout: number | undefined): number | undefined {
  if (userTimeout) return userTimeout; // user override wins
  if (bodyBytes <= 500_000) return undefined; // < 500KB: default OK
  // 1MB → 60s, 2MB → 90s, 3MB → 120s, capped at 180s
  const scaled = 30_000 + Math.ceil(bodyBytes / 1_000_000) * 30_000;
  return Math.min(scaled, 180_000);
}
