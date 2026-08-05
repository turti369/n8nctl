import { describe, it, expect } from 'vitest';
import {
  resolveNodeType,
  filterNodes,
  isCommunityNode,
  versionsLabel,
  type NodeDescription,
} from '../src/lib/node-catalog.js';

const catalog: NodeDescription[] = [
  { name: 'n8n-nodes-base.httpRequest', displayName: 'HTTP Request', version: [3, 4, 4.2], defaultVersion: 4.2 },
  { name: 'n8n-nodes-base.set', displayName: 'Edit Fields (Set)', version: 3.4 },
  { name: 'n8n-nodes-base.noOp', displayName: 'No Operation', version: 1 },
  { name: '@n8n/n8n-nodes-langchain.anthropic', displayName: 'Anthropic Chat Model', version: 1 },
];

describe('resolveNodeType', () => {
  it('matches the full type id', () => {
    expect(resolveNodeType(catalog, 'n8n-nodes-base.httpRequest')?.name).toBe('n8n-nodes-base.httpRequest');
  });
  it('matches a base short name', () => {
    expect(resolveNodeType(catalog, 'httpRequest')?.name).toBe('n8n-nodes-base.httpRequest');
  });
  it('matches a langchain short name', () => {
    expect(resolveNodeType(catalog, 'anthropic')?.name).toBe('@n8n/n8n-nodes-langchain.anthropic');
  });
  it('matches case-insensitive suffix', () => {
    expect(resolveNodeType(catalog, 'httprequest')?.name).toBe('n8n-nodes-base.httpRequest');
  });
  it('matches exact displayName case-insensitively', () => {
    expect(resolveNodeType(catalog, 'no operation')?.name).toBe('n8n-nodes-base.noOp');
  });
  it('falls back to a contains match, base nodes first', () => {
    expect(resolveNodeType(catalog, 'set')?.name).toBe('n8n-nodes-base.set');
  });
  it('returns undefined when nothing matches', () => {
    expect(resolveNodeType(catalog, 'definitelyNotANode')).toBeUndefined();
  });
});

describe('filterNodes', () => {
  it('filters by search substring on name/displayName', () => {
    expect(filterNodes(catalog, { search: 'http' }).map((n) => n.name)).toEqual(['n8n-nodes-base.httpRequest']);
  });
  it('filters community-only', () => {
    expect(filterNodes(catalog, { community: true }).map((n) => n.name)).toEqual([
      '@n8n/n8n-nodes-langchain.anthropic',
    ]);
  });
  it('sorts by type id', () => {
    const names = filterNodes(catalog).map((n) => n.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('dedupeLatest / versioned entries', () => {
  const versioned: NodeDescription[] = [
    { name: 'n8n-nodes-base.httpRequest', displayName: 'HTTP Request', version: 1, defaultVersion: 4.3 },
    { name: 'n8n-nodes-base.httpRequest', displayName: 'HTTP Request', version: [3, 4, 4.2], defaultVersion: 4.3 },
    { name: 'n8n-nodes-base.httpRequest', displayName: 'HTTP Request', version: 2, defaultVersion: 4.3 },
  ];
  it('resolveNodeType returns the highest-version entry', () => {
    expect(versionsLabel(resolveNodeType(versioned, 'httpRequest')!)).toBe('3, 4, 4.2');
  });
  it('filterNodes collapses versioned duplicates to one row', () => {
    expect(filterNodes(versioned).length).toBe(1);
  });
});

describe('isCommunityNode', () => {
  it('flags non-base packages', () => {
    expect(isCommunityNode(catalog[3])).toBe(true);
    expect(isCommunityNode(catalog[0])).toBe(false);
  });
});

describe('versionsLabel', () => {
  it('joins a version array', () => {
    expect(versionsLabel(catalog[0])).toBe('3, 4, 4.2');
  });
  it('stringifies a scalar version', () => {
    expect(versionsLabel(catalog[1])).toBe('3.4');
  });
  it('falls back to defaultVersion then dash', () => {
    expect(versionsLabel({ name: 'x.y', displayName: 'Y', defaultVersion: 2 })).toBe('2');
    expect(versionsLabel({ name: 'x.z', displayName: 'Z' })).toBe('—');
  });
});
