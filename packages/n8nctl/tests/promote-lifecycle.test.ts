import { describe, it, expect } from 'vitest';
import {
  planPromotion,
  parseMapFile,
  type TargetCredential,
} from '../src/lib/lifecycle/promote.js';
import { ValidationError } from '../src/lib/errors.js';
import type { Workflow } from '../src/types/n8n.js';

function wf(creds: Record<string, { id?: string; name?: string }>): Workflow {
  return {
    id: 'w1',
    name: 'Promo',
    nodes: [
      { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', credentials: creds } as never,
    ],
    connections: {},
  } as Workflow;
}

const targetCreds: TargetCredential[] = [
  { id: 't-http-1', name: 'Prod API', type: 'httpHeaderAuth' },
  { id: 't-sheets-1', name: 'Prod Sheets', type: 'googleSheetsOAuth2Api' },
  { id: 't-http-dup-a', name: 'Shared', type: 'httpBasicAuth' },
  { id: 't-http-dup-b', name: 'Shared', type: 'httpBasicAuth' },
];

describe('planPromotion — auto-match by (type, name)', () => {
  it('rewrites a unique type+name match to the target id', () => {
    const r = planPromotion(wf({ httpHeaderAuth: { id: 's-1', name: 'Prod API' } }), targetCreds);
    expect(r.unresolved).toHaveLength(0);
    expect(r.mappings[0].to).toEqual({ id: 't-http-1', name: 'Prod API' });
    const node = (r.workflow.nodes![0] as never as { credentials: Record<string, { id: string }> });
    expect(node.credentials.httpHeaderAuth.id).toBe('t-http-1');
    expect(r.mappings[0].via).toBe('auto-unique');
  });

  it('matches by type alone when the source name is absent and unique', () => {
    const r = planPromotion(wf({ googleSheetsOAuth2Api: { id: 's-2' } }), targetCreds);
    expect(r.mappings[0].to.id).toBe('t-sheets-1');
  });
});

describe('planPromotion — refuses to guess', () => {
  it('marks a 0-match credential as missing (does not rewrite)', () => {
    const r = planPromotion(wf({ telegramApi: { id: 's-3', name: 'Bot' } }), targetCreds);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].kind).toBe('missing');
    const node = (r.workflow.nodes![0] as never as { credentials: Record<string, { id: string }> });
    expect(node.credentials.telegramApi.id).toBe('s-3'); // unchanged
  });

  it('marks a ≥2-match credential as ambiguous (never auto-picks)', () => {
    const r = planPromotion(wf({ httpBasicAuth: { id: 's-4', name: 'Shared' } }), targetCreds);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].kind).toBe('ambiguous');
    expect(r.unresolved[0].candidates).toHaveLength(2);
  });
});

describe('planPromotion — explicit map entry wins', () => {
  it('uses a map entry by sourceId even when an auto-match exists', () => {
    const r = planPromotion(
      wf({ httpHeaderAuth: { id: 's-1', name: 'Prod API' } }),
      targetCreds,
      [{ sourceId: 's-1', targetId: 't-override', targetName: 'Override' }],
    );
    expect(r.mappings[0].to).toEqual({ id: 't-override', name: 'Override' });
    expect(r.mappings[0].via).toBe('map-file');
  });

  it('resolves an otherwise-ambiguous credential via a type+name map entry', () => {
    const r = planPromotion(
      wf({ httpBasicAuth: { id: 's-4', name: 'Shared' } }),
      targetCreds,
      [{ type: 'httpBasicAuth', name: 'Shared', targetId: 't-http-dup-b' }],
    );
    expect(r.unresolved).toHaveLength(0);
    expect(r.mappings[0].to.id).toBe('t-http-dup-b');
  });

  it('does not mutate the source workflow', () => {
    const original = wf({ httpHeaderAuth: { id: 's-1', name: 'Prod API' } });
    planPromotion(original, targetCreds);
    const node = original.nodes![0] as never as { credentials: Record<string, { id: string }> };
    expect(node.credentials.httpHeaderAuth.id).toBe('s-1');
  });
});

describe('parseMapFile', () => {
  it('accepts valid entries', () => {
    const e = parseMapFile([{ sourceId: 's', targetId: 't' }, { type: 'x', name: 'y', targetId: 'z' }]);
    expect(e).toHaveLength(2);
  });

  it('requires targetId', () => {
    expect(() => parseMapFile([{ sourceId: 's' }])).toThrow(ValidationError);
  });

  it('requires some source identifier', () => {
    expect(() => parseMapFile([{ targetId: 't' }])).toThrow(ValidationError);
  });

  it('rejects a non-array document', () => {
    expect(() => parseMapFile({ targetId: 't' })).toThrow(ValidationError);
  });
});
