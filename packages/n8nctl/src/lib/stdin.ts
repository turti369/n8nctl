import { promises as fs } from 'node:fs';
import { ValidationError } from './errors.js';

/**
 * Read JSON content from either a file path or stdin when the path is "-".
 * Follows the kubectl / gh convention: `cmd <path>` or `cmd -` (stdin).
 *
 * Returns an object with:
 *   - raw: the raw string read
 *   - source: path or "<stdin>" for error messages
 */
export async function readJsonSource(arg: string): Promise<{ raw: string; source: string }> {
  if (arg === '-') {
    if (process.stdin.isTTY) {
      throw new ValidationError(
        'Refusing to read from stdin in interactive terminal',
        'Either pipe JSON in (e.g. `cat wf.json | n8nctl workflow create -`) or pass a file path.',
      );
    }
    const raw = await readAllStdin();
    if (!raw.trim()) {
      throw new ValidationError('Received empty stdin — expected JSON');
    }
    return { raw, source: '<stdin>' };
  }

  try {
    const raw = await fs.readFile(arg, 'utf8');
    return { raw, source: arg };
  } catch (err) {
    throw new ValidationError(`Cannot read ${arg}: ${(err as Error).message}`);
  }
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}
