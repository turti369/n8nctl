import { describe, it, expect } from 'vitest';
import { validateOutputOptions, renderTemplate, printData } from '../src/lib/output.js';
import { ValidationError } from '../src/lib/errors.js';
import type { IoStreams } from '../src/lib/io.js';

function fakeIo(isTTY: boolean): { io: IoStreams; out: () => string } {
  let out = '';
  const io = { stdout: { write: (s: string) => (out += s) }, isTTY } as unknown as IoStreams;
  return { io, out: () => out };
}

describe('renderTemplate', () => {
  it('renders defined properties', async () => {
    expect(await renderTemplate('{{name}} ({{id}})', { name: 'wf', id: '42' })).toBe('wf (42)');
  });

  it('exposes the json helper', async () => {
    expect(await renderTemplate('{{json v}}', { v: { a: 1 } })).toBe('{\n  "a": 1\n}');
  });

  // strict:true contract (documented in the renderTemplate JSDoc): a typo'd
  // field must throw, not silently render an empty string.
  it('throws ValidationError on an undefined property reference (strict mode)', async () => {
    await expect(renderTemplate('{{nonexistent}}', { name: 'wf' })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError on a nested undefined reference', async () => {
    await expect(renderTemplate('{{meta.missing}}', { meta: {} })).rejects.toThrow(ValidationError);
  });
});

describe('printData (lazy-imported table/handlebars)', () => {
  const tableView = () => ({ head: ['id', 'name'], rows: [['1', 'wf']] });

  it('renders a table on a TTY (lazy `table` import path)', async () => {
    const { io, out } = fakeIo(true);
    await printData({ id: '1' }, { io, opts: {} }, tableView);
    expect(out()).toContain('│'); // table border drawn
    expect(out()).toContain('wf');
  });

  it('renders via --template (lazy `handlebars` import path)', async () => {
    const { io, out } = fakeIo(true);
    await printData({ id: '1', name: 'wf' }, { io, opts: { template: '{{id}}:{{name}}' } });
    expect(out().trim()).toBe('1:wf');
  });

  it('emits JSON on a non-TTY regardless of tableView', async () => {
    const { io, out } = fakeIo(false);
    await printData({ id: '1' }, { io, opts: {} }, tableView);
    expect(out()).toContain('"id": "1"');
    expect(out()).not.toContain('│');
  });
});

describe('validateOutputOptions', () => {
  it('accepts no flags', () => {
    expect(() => validateOutputOptions({})).not.toThrow();
  });
  it('accepts one flag', () => {
    expect(() => validateOutputOptions({ json: true })).not.toThrow();
    expect(() => validateOutputOptions({ jq: '.' })).not.toThrow();
    expect(() => validateOutputOptions({ template: '{{id}}' })).not.toThrow();
  });
  it('rejects two flags together', () => {
    expect(() => validateOutputOptions({ json: true, jq: '.' })).toThrow(ValidationError);
    expect(() => validateOutputOptions({ jq: '.', template: '{{id}}' })).toThrow(ValidationError);
  });
});
