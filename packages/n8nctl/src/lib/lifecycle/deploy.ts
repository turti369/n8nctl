/**
 * Pure helpers for the `workflow deploy` sequencer (no I/O). Kept under
 * lib/lifecycle/ alongside verify/rollback/promote so the orchestration stays
 * composable and unit-testable without a live instance.
 */

export interface WebhookProbeTarget {
  nodeName: string;
  method: string;
  url: string;
}

interface NodeLike {
  name?: string;
  type?: string;
  disabled?: boolean;
  parameters?: { path?: string; httpMethod?: string };
}

/**
 * Derive the production webhook URLs to probe after activation. A workflow can
 * show `active: true` in the DB yet not have its webhook route registered in
 * the running process (queue mode / separate webhook process — documented in
 * refresh.ts), so deploy probes the real URL to confirm the trigger is LIVE.
 */
export function webhookProbeTargets(
  nodes: NodeLike[] | undefined,
  host: string,
): WebhookProbeTarget[] {
  return (nodes ?? [])
    .filter((n) => n.type === 'n8n-nodes-base.webhook' && !n.disabled && n.parameters?.path)
    .map((n) => ({
      nodeName: n.name ?? '(unnamed)',
      method: (n.parameters?.httpMethod ?? 'GET').toUpperCase(),
      url: `${host.replace(/\/+$/, '')}/webhook/${n.parameters!.path}`,
    }));
}

/** True if the workflow has any non-webhook, non-disabled trigger (schedule/manual/etc.). */
export function hasNonWebhookTrigger(nodes: NodeLike[] | undefined): boolean {
  return (nodes ?? []).some((n) => {
    if (n.disabled) return false;
    const t = (n.type ?? '').toLowerCase();
    return (t.includes('trigger') || t.endsWith('.cron')) && !t.includes('webhook');
  });
}

export type NameMatch =
  | { kind: 'create' }
  | { kind: 'update'; id: string }
  | { kind: 'ambiguous'; ids: string[] };

/**
 * Resolve a create-or-update decision from same-name matches on the target.
 * Exactly one match → update; none → create; multiple → ambiguous (caller must
 * refuse and require an explicit --id — updating the wrong workflow is a
 * production data-loss path, mirroring promote's credential-ambiguity rule).
 */
export function resolveNameMatch(matches: Array<{ id: string }>): NameMatch {
  if (matches.length === 0) return { kind: 'create' };
  if (matches.length === 1) return { kind: 'update', id: matches[0].id };
  return { kind: 'ambiguous', ids: matches.map((m) => m.id) };
}
