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
