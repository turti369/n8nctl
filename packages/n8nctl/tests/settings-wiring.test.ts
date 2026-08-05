import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { printData, type OutputOptions } from '../src/lib/output.js';
import type { IoStreams } from '../src/lib/io.js';

/**
 * Verifies config `settings.{outputFormat,color}` are actually wired into the
 * runtime (they were previously write-only dead config: set/get worked but
 * nothing read them).
 */

function fakeIo(isTTY: boolean): { io: IoStreams; out: () => string } {
  let out = '';
  const io = {
    stdout: { write: (s: string) => (out += s) },
    isTTY,
  } as unknown as IoStreams;
  return { io, out: () => out };
}

const tableView = (): { head: string[]; rows: string[][] } => ({
  head: ['id'],
  rows: [['1']],
});

describe('settings.outputFormat wiring (printData)', () => {
  it("outputFormat 'json' forces JSON on a TTY even when a tableView exists", async () => {
    const { io, out } = fakeIo(true);
    const opts: OutputOptions = { outputFormat: 'json' };
    await printData({ id: '1' }, { io, opts }, tableView);
    expect(out()).toContain('"id": "1"');
    expect(out()).not.toContain('│'); // no table borders
  });

  it("outputFormat 'table' keeps the table view on a TTY", async () => {
    const { io, out } = fakeIo(true);
    const opts: OutputOptions = { outputFormat: 'table' };
    await printData({ id: '1' }, { io, opts }, tableView);
    expect(out()).toContain('│');
  });

  it("outputFormat 'auto' preserves default TTY behaviour (table)", async () => {
    const { io, out } = fakeIo(true);
    const opts: OutputOptions = { outputFormat: 'auto' };
    await printData({ id: '1' }, { io, opts }, tableView);
    expect(out()).toContain('│');
  });

  it('explicit --json still wins on a non-TTY (JSON regardless of format)', async () => {
    const { io, out } = fakeIo(false);
    const opts: OutputOptions = { outputFormat: 'table', json: true };
    await printData({ id: '1' }, { io, opts }, tableView);
    expect(out()).toContain('"id": "1"');
  });
});

describe('settings.color wiring (createIoStreams precedence)', () => {
  const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });
  afterEach(() => {
    if (saved.NO_COLOR === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = saved.NO_COLOR;
    if (saved.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = saved.FORCE_COLOR;
  });

  it("settings.color 'always' enables color regardless of TTY", async () => {
    const { createIoStreams } = await import('../src/lib/io.js');
    expect(createIoStreams(undefined, 'always').isColorEnabled).toBe(true);
  });

  it("settings.color 'never' disables color", async () => {
    const { createIoStreams } = await import('../src/lib/io.js');
    expect(createIoStreams(undefined, 'never').isColorEnabled).toBe(false);
  });

  it('NO_COLOR overrides settings.color=always (hard off)', async () => {
    process.env.NO_COLOR = '1';
    const { createIoStreams } = await import('../src/lib/io.js');
    expect(createIoStreams(undefined, 'always').isColorEnabled).toBe(false);
  });

  it('FORCE_COLOR overrides settings.color=never (override on)', async () => {
    process.env.FORCE_COLOR = '1';
    const { createIoStreams } = await import('../src/lib/io.js');
    expect(createIoStreams(undefined, 'never').isColorEnabled).toBe(true);
  });
});
