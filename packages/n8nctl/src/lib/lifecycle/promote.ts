import { ValidationError } from '../errors.js';
import type { Workflow } from '../../types/n8n.js';

/**
 * Cross-instance workflow promotion (dev → prod). Pure transform: takes a
 * source workflow + the target instance's credentials + an optional mapping
 * file, and produces a workflow whose credential references point at the
 * TARGET instance's credential ids — or a list of unresolved references that
 * MUST stop the promotion (no silent mis-binding).
 *
 * Safety (plan dt-r1-06): credential NAMES are not unique in n8n, so a
 * blind match-by-name can bind a production workflow to the WRONG secret.
 * Rules:
 *   - auto-match by (type, name) ONLY when exactly ONE target credential
 *     matches → safe.
 *   - 0 matches  → unresolved (kind: 'missing').
 *   - ≥2 matches → unresolved (kind: 'ambiguous') — even --allow-unmapped does
 *     NOT auto-pick; an explicit map entry is required.
 *   - an explicit map entry (by source id, or by type+name) always wins.
 */

export interface TargetCredential {
  id: string;
  name: string;
  type: string;
}

export interface CredentialRefSite {
  nodeName: string;
  credType: string;
  sourceId?: string;
  sourceName?: string;
}

export type UnresolvedKind = 'missing' | 'ambiguous';

export interface UnresolvedCredential extends CredentialRefSite {
  kind: UnresolvedKind;
  candidates: TargetCredential[];
}

export interface CredentialMapping {
  nodeName: string;
  credType: string;
  from: { id?: string; name?: string };
  to: { id: string; name: string };
  via: 'map-file' | 'auto-unique';
}

export interface PromoteMapFileEntry {
  /** Match the source credential by id (preferred) or type+name. */
  sourceId?: string;
  type?: string;
  name?: string;
  /** Target credential id on the destination instance (REQUIRED). */
  targetId: string;
  targetName?: string;
}

export interface PromoteResult {
  workflow: Workflow;
  mappings: CredentialMapping[];
  unresolved: UnresolvedCredential[];
}

interface NodeWithCreds {
  name?: string;
  credentials?: Record<string, { id?: string; name?: string }>;
}

/** Find a map-file entry matching a reference site (by source id, then type+name). */
function findMapEntry(
  entries: PromoteMapFileEntry[],
  site: CredentialRefSite,
): PromoteMapFileEntry | undefined {
  if (site.sourceId) {
    const byId = entries.find((e) => e.sourceId && e.sourceId === site.sourceId);
    if (byId) return byId;
  }
  return entries.find(
    (e) =>
      !e.sourceId &&
      (e.type === undefined || e.type === site.credType) &&
      (e.name === undefined || e.name === site.sourceName),
  );
}

export function planPromotion(
  source: Workflow,
  targetCredentials: TargetCredential[],
  mapEntries: PromoteMapFileEntry[] = [],
): PromoteResult {
  const workflow = structuredClone(source) as Workflow & { nodes?: NodeWithCreds[] };
  const mappings: CredentialMapping[] = [];
  const unresolved: UnresolvedCredential[] = [];

  for (const node of workflow.nodes ?? []) {
    if (!node.credentials) continue;
    for (const [credType, ref] of Object.entries(node.credentials)) {
      const site: CredentialRefSite = {
        nodeName: node.name ?? '(unnamed)',
        credType,
        sourceId: ref?.id,
        sourceName: ref?.name,
      };

      // 1. Explicit map entry wins.
      const mapEntry = findMapEntry(mapEntries, site);
      if (mapEntry) {
        const targetName =
          mapEntry.targetName ??
          targetCredentials.find((c) => c.id === mapEntry.targetId)?.name ??
          ref?.name ??
          '(mapped)';
        node.credentials[credType] = { id: mapEntry.targetId, name: targetName };
        mappings.push({
          nodeName: site.nodeName,
          credType,
          from: { id: site.sourceId, name: site.sourceName },
          to: { id: mapEntry.targetId, name: targetName },
          via: 'map-file',
        });
        continue;
      }

      // 2. Auto-match by (type, name) — only when EXACTLY one candidate.
      const candidates = targetCredentials.filter(
        (c) => c.type === credType && (site.sourceName === undefined || c.name === site.sourceName),
      );
      if (candidates.length === 1) {
        node.credentials[credType] = { id: candidates[0].id, name: candidates[0].name };
        mappings.push({
          nodeName: site.nodeName,
          credType,
          from: { id: site.sourceId, name: site.sourceName },
          to: { id: candidates[0].id, name: candidates[0].name },
          via: 'auto-unique',
        });
        continue;
      }

      // 3. Unresolved — never guess.
      unresolved.push({
        ...site,
        kind: candidates.length === 0 ? 'missing' : 'ambiguous',
        candidates,
      });
    }
  }

  return { workflow, mappings, unresolved };
}

/** Parse + validate a promotion map file (JSON array of entries). */
export function parseMapFile(raw: unknown): PromoteMapFileEntry[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('Map file must be a JSON array of mapping entries');
  }
  return raw.map((e, i) => {
    if (!e || typeof e !== 'object') throw new ValidationError(`map[${i}] must be an object`);
    const entry = e as Record<string, unknown>;
    if (typeof entry.targetId !== 'string' || !entry.targetId) {
      throw new ValidationError(`map[${i}] requires a string \`targetId\``);
    }
    if (!entry.sourceId && !entry.type && !entry.name) {
      throw new ValidationError(
        `map[${i}] must identify the source credential by \`sourceId\` or \`type\`+\`name\``,
      );
    }
    return {
      sourceId: entry.sourceId as string | undefined,
      type: entry.type as string | undefined,
      name: entry.name as string | undefined,
      targetId: entry.targetId,
      targetName: entry.targetName as string | undefined,
    };
  });
}

/** A redacted, human-readable mapping report (never prints secret values). */
export function formatMappingReport(result: PromoteResult): string {
  const lines: string[] = [];
  for (const m of result.mappings) {
    lines.push(
      `  ${m.nodeName} [${m.credType}] ${m.from.name ?? m.from.id ?? '(none)'} → ${m.to.name} (${m.to.id}) via ${m.via}`,
    );
  }
  for (const u of result.unresolved) {
    lines.push(
      `  ✗ ${u.nodeName} [${u.credType}] ${u.sourceName ?? u.sourceId ?? '(none)'} — ${u.kind}${u.candidates.length ? ` (${u.candidates.length} candidates)` : ''}`,
    );
  }
  return lines.join('\n');
}
