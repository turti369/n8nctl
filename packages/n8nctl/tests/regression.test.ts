/**
 * Regression tests for bugs fixed in v0.1.1.
 * Each test pins a specific bug so future refactors can't silently reintroduce it.
 */
import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { stripReadOnlyFields } from '../src/lib/workflow-body.js';

describe('v0.1.1 regression: Commander --no-keyring parsing', () => {
  it('Commander maps --no-keyring to { keyring: false }, not { noKeyring: true }', async () => {
    const p = new Command();
    p.option('--no-keyring', 'disable keyring');
    let captured: Record<string, unknown> | null = null;
    p.action((opts: Record<string, unknown>) => {
      captured = opts;
    });
    await p.parseAsync(['node', 'test', '--no-keyring']);
    expect(captured).not.toBeNull();
    expect((captured as unknown as { keyring: boolean }).keyring).toBe(false);
    expect((captured as unknown as { noKeyring?: boolean }).noKeyring).toBeUndefined();
  });

  it('without --no-keyring, keyring defaults to true', async () => {
    const p = new Command();
    p.option('--no-keyring', 'disable keyring');
    let captured: Record<string, unknown> | null = null;
    p.action((opts: Record<string, unknown>) => {
      captured = opts;
    });
    await p.parseAsync(['node', 'test']);
    expect((captured as unknown as { keyring: boolean }).keyring).toBe(true);
  });
});

describe('v0.1.1 regression: stripReadOnlyFields', () => {
  it('removes server-managed fields from workflow body', () => {
    const input = {
      id: '42',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-04-23T00:00:00Z',
      versionId: 'v1',
      active: true,
      tags: [{ id: 't1', name: 'deployed' }],
      nodes: [],
      connections: {},
    };
    const output = stripReadOnlyFields(input);
    expect(output).not.toHaveProperty('id');
    expect(output).not.toHaveProperty('createdAt');
    expect(output).not.toHaveProperty('updatedAt');
    expect(output).not.toHaveProperty('versionId');
    expect(output).not.toHaveProperty('active');
    expect(output).not.toHaveProperty('tags');
    expect(output).toHaveProperty('name', 'Test');
    expect(output).toHaveProperty('nodes');
    expect(output).toHaveProperty('connections');
  });

  it('handles partial inputs gracefully', () => {
    const output = stripReadOnlyFields({ name: 'Partial' });
    expect(output).toEqual({ name: 'Partial' });
  });

  it('never mutates the input object', () => {
    const input = { id: '1', name: 'x', active: true };
    const frozen = Object.freeze({ ...input });
    expect(() => stripReadOnlyFields(frozen)).not.toThrow();
    expect(frozen).toHaveProperty('id'); // original untouched
  });
});

describe('v0.4.0 regression: stripReadOnlyFields whitelist (n8n PUT 400 fix)', () => {
  it('drops pinData (client-side test cache that n8n rejects)', () => {
    const out = stripReadOnlyFields({
      name: 'x',
      nodes: [],
      connections: {},
      pinData: { 'Webhook Node': [{ json: { foo: 'bar' } }] },
    });
    expect(out).not.toHaveProperty('pinData');
  });

  it('drops staticData (server-side runtime state)', () => {
    const out = stripReadOnlyFields({
      name: 'x',
      nodes: [],
      connections: {},
      staticData: { lastRun: '2026-05-08' },
    });
    expect(out).not.toHaveProperty('staticData');
  });

  it('drops meta (server-side template metadata)', () => {
    const out = stripReadOnlyFields({
      name: 'x',
      nodes: [],
      connections: {},
      meta: { templateCredsSetupCompleted: true },
    });
    expect(out).not.toHaveProperty('meta');
  });

  it('drops unknown future fields (whitelist is forward-safe)', () => {
    const out = stripReadOnlyFields({
      name: 'x',
      nodes: [],
      connections: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      futureField: { wat: 1 },
    } as any);
    expect(out).not.toHaveProperty('futureField');
  });

  it('full backup payload reduces to exactly 4 allowed keys', () => {
    const fullBackup = {
      id: '42',
      name: 'Backup',
      active: true,
      nodes: [{ id: 'n1', name: 'Start', type: 't', typeVersion: 1, position: [0, 0] as [number, number], parameters: {} }],
      connections: { Start: { main: [] } },
      settings: { executionOrder: 'v1' },
      staticData: { runs: 7 },
      tags: [{ id: 't', name: 'prod' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-05-08T00:00:00Z',
      versionId: 'v3',
      meta: { x: 1 },
      pinData: { N: [] },
    };
    const out = stripReadOnlyFields(fullBackup);
    expect(Object.keys(out).sort()).toEqual(['connections', 'name', 'nodes', 'settings']);
  });

  it('preserves settings when present', () => {
    const out = stripReadOnlyFields({
      name: 'x',
      nodes: [],
      connections: {},
      settings: { saveDataErrorExecution: 'all', timezone: 'Asia/Ho_Chi_Minh' },
    });
    expect(out.settings).toEqual({ saveDataErrorExecution: 'all', timezone: 'Asia/Ho_Chi_Minh' });
  });

  it('omits settings when input has no settings (does not inject default)', () => {
    const out = stripReadOnlyFields({ name: 'x', nodes: [], connections: {} });
    expect(out).not.toHaveProperty('settings');
  });

  it('drops triggerCount + shared (fields n8n attaches to GET /workflows responses)', () => {
    // Reported bug: `workflow create` from a file fetched via GET (or exported
    // by the UI) carries triggerCount + shared, which n8n POST/PUT reject with
    // 400. The blacklist version missed these; the whitelist drops them.
    const out = stripReadOnlyFields({
      name: 'x',
      nodes: [],
      connections: {},
      triggerCount: 3,
      shared: [{ role: 'workflow:owner', userId: 'u1' }],
      tags: [{ id: 't', name: 'prod' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(out).not.toHaveProperty('triggerCount');
    expect(out).not.toHaveProperty('shared');
    expect(out).not.toHaveProperty('tags');
    expect(Object.keys(out).sort()).toEqual(['connections', 'name', 'nodes']);
  });
});
