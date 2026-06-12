import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMANDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Exit-code policy (docs/EXIT_CODES.md): command handlers never call
 * process.exit() — it truncates pending async stdout/stderr flushes on
 * Windows. Only runtime.ts handleError and the index.ts fatal catch exit.
 * Handlers set process.exitCode and return.
 */
describe('exit-code policy', () => {
  it('no process.exit() calls anywhere under src/commands/', () => {
    const offenders: string[] = [];
    for (const file of tsFilesUnder(COMMANDS_DIR)) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        const noComment = line.replace(/\/\/.*$/, '');
        if (noComment.includes('process.exit(')) {
          offenders.push(`${path.relative(COMMANDS_DIR, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
