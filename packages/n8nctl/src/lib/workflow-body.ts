import type { Workflow } from '../types/n8n.js';

/**
 * n8n Public API rejects these fields when included in POST/PUT bodies:
 * - id, createdAt, updatedAt, versionId → server-generated
 * - active → use activate/deactivate endpoints
 * - tags → use PUT /workflows/{id}/tags endpoint
 *
 * Strip them consistently across create/update/restore/import.
 */
export function stripReadOnlyFields(wf: Partial<Workflow>): Partial<Workflow> {
  const { id, createdAt, updatedAt, versionId, active, tags, ...body } = wf;
  void id; void createdAt; void updatedAt; void versionId; void active; void tags;
  return body;
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
