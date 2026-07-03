import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  transformToCatalog,
  resolveSyncedCatalog,
  bundledNodeCount,
  syncedCatalogPath,
} from '../src/lib/validator-catalog.js';
import type { NodeDescription } from '../src/lib/node-catalog.js';

const sampleNodes: NodeDescription[] = [
  {
    name: 'n8n-nodes-base.httpRequest',
    displayName: 'HTTP Request',
    version: [3, 4],
    properties: [
      { name: 'url', type: 'string', required: true },
      { name: 'method', type: 'options', options: [{ name: 'GET', value: 'GET' }, { name: 'POST', value: 'POST' }] },
      { name: 'timeout', type: 'number' },
      { name: 'gated', type: 'string', required: true, displayOptions: { show: { method: ['POST'] } } },
    ],
  },
  // A second, older entry for the same type — versions must aggregate.
  { name: 'n8n-nodes-base.httpRequest', displayName: 'HTTP Request', version: 2, properties: [] },
  { name: 'n8n-nodes-base.set', displayName: 'Edit Fields', version: 1, properties: [{ name: 'value', type: 'string' }] },
];

describe('transformToCatalog', () => {
  it('maps node types with required/optional/enums and aggregated versions', () => {
    const cat = transformToCatalog(sampleNodes, 'https://n8n.test');
    expect(Object.keys(cat.nodes).sort()).toEqual([
      'n8n-nodes-base.httpRequest',
      'n8n-nodes-base.set',
    ]);
    const http = cat.nodes['n8n-nodes-base.httpRequest'];
    // versions aggregated across all entries of the type
    expect(http.typeVersion).toEqual([2, 3, 4]);
    // required (non-displayOptions) vs optional
    expect(http.required.url).toBe('string');
    expect(http.optional.timeout).toBe('number');
    // displayOptions-gated "required" is treated as optional (avoids false positives)
    expect(http.optional.gated).toBe('string');
    expect(http.required.gated).toBeUndefined();
    // options → enum values
    expect(http.enums?.method).toEqual(['GET', 'POST']);
    expect(cat._meta?.description).toContain('n8n.test');
  });
});

describe('resolveSyncedCatalog', () => {
  const saved = process.env.N8N_VALIDATOR_CATALOG;
  afterEach(() => {
    if (saved === undefined) delete process.env.N8N_VALIDATOR_CATALOG;
    else process.env.N8N_VALIDATOR_CATALOG = saved;
  });

  it('returns null when there is no synced catalog', () => {
    delete process.env.N8N_VALIDATOR_CATALOG;
    expect(resolveSyncedCatalog('does-not-exist-profile-xyz')).toBeNull();
  });

  it('loads a catalog from the N8N_VALIDATOR_CATALOG env path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-cat-'));
    const file = path.join(dir, 'cat.json');
    const cat = transformToCatalog(sampleNodes, 'https://n8n.test');
    await fs.writeFile(file, JSON.stringify(cat), 'utf8');
    process.env.N8N_VALIDATOR_CATALOG = file;
    const loaded = resolveSyncedCatalog('anything');
    expect(loaded?.nodes['n8n-nodes-base.set']).toBeDefined();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns null on a corrupt catalog file (falls back to bundled, never throws)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8nctl-cat-'));
    const file = path.join(dir, 'bad.json');
    await fs.writeFile(file, '{ not json', 'utf8');
    process.env.N8N_VALIDATOR_CATALOG = file;
    expect(resolveSyncedCatalog('anything')).toBeNull();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('bundledNodeCount + syncedCatalogPath', () => {
  it('bundled catalog has nodes (sanity-gate floor)', () => {
    expect(bundledNodeCount()).toBeGreaterThan(0);
  });
  it('sanitizes the profile name in the path (no traversal)', () => {
    const p = syncedCatalogPath('weird/../name');
    expect(p).toMatch(/node-catalog\.weird____name\.json$/);
    expect(p).not.toContain('..'); // no path traversal survives
  });
});
