import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { NodeCatalog } from './types.js';

const DEFAULT_CATALOG_FILENAME = 'node-catalog.json';

let cachedCatalog: NodeCatalog | null | undefined;

export function loadCatalog(explicitPath?: string): NodeCatalog | null {
  if (explicitPath) {
    if (!existsSync(explicitPath)) return null;
    return JSON.parse(readFileSync(explicitPath, 'utf8')) as NodeCatalog;
  }

  if (cachedCatalog !== undefined) return cachedCatalog;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, '..', DEFAULT_CATALOG_FILENAME),
    path.join(here, '..', '..', DEFAULT_CATALOG_FILENAME),
    path.join(process.cwd(), DEFAULT_CATALOG_FILENAME),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        cachedCatalog = JSON.parse(readFileSync(p, 'utf8')) as NodeCatalog;
        return cachedCatalog;
      } catch {
        // fall through
      }
    }
  }

  cachedCatalog = null;
  return null;
}

export function clearCatalogCache(): void {
  cachedCatalog = undefined;
}
