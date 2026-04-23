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
