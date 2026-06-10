import { createHash, randomUUID } from 'node:crypto';
import type { Workflow } from '../types/n8n.js';

/** UUID format (any version) — n8n generates UUID node ids. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Derive a STABLE UUID (v5-style) from a node name so re-normalizing the same
 * file yields identical ids — no node-id churn on repeated `update`s, and
 * stable diffs. Node names are unique within a valid workflow (validator E013).
 * Falls back to random only for an empty name.
 */
function stableNodeId(name: string): string {
  if (!name) return randomUUID();
  const h = createHash('sha1').update(`n8nctl-node:${name}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Execution-log defaults so a deployed workflow is observable/debuggable.
 * n8n falls back to instance defaults (often "none") when these are unset,
 * which makes failures invisible to `n8nctl execution get`.
 */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  executionOrder: 'v1',
  saveDataErrorExecution: 'all',
  saveDataSuccessExecution: 'all',
  saveManualExecutions: true,
};

export interface NormalizeResult {
  workflow: Workflow;
  changes: string[];
}

/**
 * Normalize a workflow JSON to n8n conventions WITHOUT changing behaviour:
 *
 *  1. Node ids → UUID for any non-UUID/missing id. SAFE because n8n keys
 *     connections, pinData, and `$node[...]` expressions on the node NAME, not
 *     the id. Existing valid UUIDs are kept stable (no churn).
 *  2. Settings → inject execution-log defaults if absent (merge, never
 *     overwrite an explicit value).
 *
 * Does NOT touch typeVersion — bumping is risky (params differ across
 * versions); the validator warns (E072) and /n8n-build picks the latest at
 * generation time instead.
 *
 * Returns a CLONE plus a human-readable list of what changed.
 */
export function normalizeWorkflow(input: Workflow): NormalizeResult {
  const wf = structuredClone(input);
  const changes: string[] = [];

  for (const node of wf.nodes ?? []) {
    if (!node.id || typeof node.id !== 'string' || !UUID_RE.test(node.id)) {
      const old = node.id;
      node.id = stableNodeId(node.name ?? '');
      changes.push(`node "${node.name ?? '?'}" id ${old ? `"${old}"` : '(missing)'} → UUID`);
    }
  }

  const settings = (wf.settings ?? {}) as Record<string, unknown>;
  const injected: string[] = [];
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in settings)) {
      settings[k] = v;
      injected.push(k);
    }
  }
  if (injected.length > 0) {
    wf.settings = settings;
    changes.push(`settings: added ${injected.join(', ')}`);
  }

  return { workflow: wf, changes };
}
