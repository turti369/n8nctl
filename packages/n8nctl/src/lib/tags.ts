import type { N8nClient } from './api.js';
import type { WorkflowTag } from '../types/n8n.js';

/**
 * Fetch ALL tags via cursor pagination. Replaces the `{ limit: 250 }`
 * single-page fetch that silently dropped tags beyond the first page
 * (so `workflow tag` reported "Tag not found" for real tags on large
 * instances).
 */
export async function fetchAllTags(client: N8nClient): Promise<WorkflowTag[]> {
  const tags: WorkflowTag[] = [];
  for await (const t of client.paginate<WorkflowTag>('/tags', { limit: 100 })) {
    tags.push(t);
  }
  return tags;
}
