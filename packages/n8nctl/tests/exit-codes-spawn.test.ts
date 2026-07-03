import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Spawn-level assertions for the frozen exit-code contract (docs/EXIT_CODES.md):
 * Commander parse errors must exit 3 (ValidationError), NOT 1 (ApiError) or 5
 * (InternalError); --help/--version are informational displays and exit 0.
 * Runs the built CLI end-to-end so it exercises exitOverride + the top-level
 * catch together (a unit test on the program object can't see process.exit).
 */
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

function run(args: string[]): number {
  const r = spawnSync(process.execPath, [DIST, ...args], { encoding: 'utf8' });
  return r.status ?? -1;
}

describe.skipIf(!existsSync(DIST))('exit-code contract (spawned CLI)', () => {
  it('unknown root option → 3', () => {
    expect(run(['--nonexistent-flag'])).toBe(3);
  });

  it('unknown SUBCOMMAND option → 3', () => {
    expect(run(['workflow', 'list', '--bogus'])).toBe(3);
  });

  it('invalid --timeout argument → 3', () => {
    expect(run(['--timeout', 'abc', 'workflow', 'list'])).toBe(3);
  });

  it('unknown command → 3', () => {
    expect(run(['frobnicate'])).toBe(3);
  });

  it('--version → 0', () => {
    expect(run(['--version'])).toBe(0);
  });

  it('--help → 0', () => {
    expect(run(['--help'])).toBe(0);
  });

  it('subcommand --help → 0', () => {
    expect(run(['workflow', '--help'])).toBe(0);
  });
});
