import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getConfigDir } from './config.js';
import type { N8nSessionClient } from './session-api.js';

/**
 * Live node-type catalog fetched from the instance's own editor asset
 * (`GET <host>/types/nodes.json`) — the exact set of nodes (incl. community /
 * langchain packages) for THIS instance's version, not a bundled snapshot.
 * The payload is large (~14 MB), so it is cached under the config dir with a
 * 24h TTL; `--refresh` forces a refetch.
 */

export interface NodeCredentialRef {
  name: string;
  required?: boolean;
}

export interface NodeProperty {
  name: string;
  displayName?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  options?: unknown[];
  displayOptions?: unknown;
  typeOptions?: unknown;
}

export interface NodeDescription {
  name: string; // e.g. n8n-nodes-base.httpRequest
  displayName: string;
  description?: string;
  group?: string[];
  version?: number | number[];
  defaultVersion?: number;
  credentials?: NodeCredentialRef[];
  properties?: NodeProperty[];
  usableAsTool?: boolean;
}

interface CacheShape {
  fetchedAt: number;
  host: string;
  count: number;
  nodes: NodeDescription[];
}

const ENDPOINT = '/types/nodes.json';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const BASE_PKGS = ['n8n-nodes-base', '@n8n/n8n-nodes-langchain'];

function cacheFile(host: string): string {
  const hash = createHash('sha1').update(host).digest('hex').slice(0, 12);
  return path.join(getConfigDir(), 'cache', `node-types-${hash}.json`);
}

/**
 * Fetch (or load from cache) the full node catalog for the session's host.
 * Uses the SESSION client because `/types/nodes.json` is served behind editor
 * auth (the api-key client 401s on it).
 */
export async function loadNodeCatalog(
  session: N8nSessionClient,
  opts: { refresh?: boolean } = {},
): Promise<NodeDescription[]> {
  const file = cacheFile(session.host);
  if (!opts.refresh && existsSync(file)) {
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf8')) as CacheShape;
      if (cached && Array.isArray(cached.nodes) && Date.now() - cached.fetchedAt < TTL_MS) {
        return cached.nodes;
      }
    } catch {
      /* corrupt cache → refetch */
    }
  }
  const nodes = await session.getRootJson<NodeDescription[]>(ENDPOINT);
  const payload: CacheShape = {
    fetchedAt: Date.now(),
    host: session.host,
    count: nodes.length,
    nodes,
  };
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* cache is best-effort; a failed write must not break the command */
  }
  return nodes;
}

export function isCommunityNode(n: NodeDescription): boolean {
  return !n.name.startsWith('n8n-nodes-base.');
}

function maxVersion(n: NodeDescription): number {
  if (Array.isArray(n.version)) return n.version.length ? Math.max(...n.version) : 0;
  if (typeof n.version === 'number') return n.version;
  return n.defaultVersion ?? 0;
}

/**
 * The catalog lists one entry PER major node version (46 names have 2–3
 * entries). Collapse to a single entry per type — the one with the highest
 * version, i.e. the current schema (most properties). This is what `describe`
 * and `list` should surface.
 */
export function dedupeLatest(nodes: NodeDescription[]): NodeDescription[] {
  const best = new Map<string, NodeDescription>();
  for (const n of nodes) {
    const cur = best.get(n.name);
    if (!cur || maxVersion(n) > maxVersion(cur)) best.set(n.name, n);
  }
  return [...best.values()];
}

/**
 * Resolve a user-supplied node reference to a catalog entry. Accepts the full
 * type (`n8n-nodes-base.httpRequest`), a short name (`httpRequest`), or a
 * case-insensitive displayName / suffix match (`http request`, `http`).
 */
export function resolveNodeType(
  nodes: NodeDescription[],
  query: string,
): NodeDescription | undefined {
  const q = query.trim();
  const deduped = dedupeLatest(nodes);
  const byName = new Map(deduped.map((n) => [n.name, n]));
  // 1. exact full type
  if (byName.has(q)) return byName.get(q);
  // 2. base-prefixed short name (httpRequest → n8n-nodes-base.httpRequest, etc.)
  for (const pkg of BASE_PKGS) {
    const full = `${pkg}.${q}`;
    if (byName.has(full)) return byName.get(full);
  }
  const ql = q.toLowerCase();
  // 3. case-insensitive suffix on the type id (…​.httprequest)
  const suffix = deduped.find((n) => n.name.toLowerCase().endsWith(`.${ql}`));
  if (suffix) return suffix;
  // 4. exact displayName (case-insensitive)
  const dn = deduped.find((n) => n.displayName?.toLowerCase() === ql);
  if (dn) return dn;
  // 5. displayName / type contains the query — first match, base nodes first
  const contains = deduped
    .filter(
      (n) =>
        n.displayName?.toLowerCase().includes(ql) || n.name.toLowerCase().includes(ql),
    )
    .sort((a, b) => Number(isCommunityNode(a)) - Number(isCommunityNode(b)));
  return contains[0];
}

/** Filter + sort for `node list` / `node search`. */
export function filterNodes(
  nodes: NodeDescription[],
  opts: { search?: string; community?: boolean } = {},
): NodeDescription[] {
  let out = dedupeLatest(nodes);
  if (opts.community) out = out.filter(isCommunityNode);
  if (opts.search) {
    const s = opts.search.toLowerCase();
    out = out.filter(
      (n) => n.name.toLowerCase().includes(s) || n.displayName?.toLowerCase().includes(s),
    );
  }
  return [...out].sort((a, b) => a.name.localeCompare(b.name));
}

/** Normalize the `version` field (number | number[]) to a display string. */
export function versionsLabel(n: NodeDescription): string {
  if (Array.isArray(n.version)) return n.version.join(', ');
  if (typeof n.version === 'number') return String(n.version);
  return n.defaultVersion != null ? String(n.defaultVersion) : '—';
}
