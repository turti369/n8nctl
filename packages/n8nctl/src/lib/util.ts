import { ValidationError } from './errors.js';

/** Shared sleep — clamps negative durations (was copy-pasted in 5 files). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Strip ANSI escape sequences and other control characters from untrusted
 * strings before they hit a terminal (error text, table cells built from
 * remote workflow names, etc.).
 *
 * Note: the C0/C1 range alone already neutralises escape sequences (ESC=0x1B
 * sits inside \x0B-\x1F, so a sequence can never EXECUTE) — but stripping only
 * the introducer leaves the printable sequence body behind as residue
 * ("[2J", "]0;title"). The sequence-aware pass removes the whole sequence:
 * CSI (ESC[ / 0x9B), OSC (ESC] … BEL|ST), DCS/SOS/PM/APC (ESC P/X/^/_ … ST),
 * and 2-char ESC sequences.
 */
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCES =
  /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)?|[PX^_][\s\S]*?(?:\x1B\\|$)|[@-Z\\-_])|\x9B[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;
export function scrubAnsi(input: string): string {
  return input.replace(ANSI_SEQUENCES, '').replace(CONTROL_CHARS, '');
}

/**
 * Parse a numeric CLI flag value (--limit, --timeout, --delay, ...).
 * `Number('abc')` is NaN and used to be sent to the n8n API verbatim as the
 * string "NaN"; this guard turns that into a ValidationError (exit 3) instead.
 * Returns `def` when the flag was not passed. `min` defaults to 1 (most flags
 * are counts/durations ≥1); pass `min: 0` for flags where 0 is meaningful
 * (e.g. `--delay 0` = no pause).
 */
export function parsePositiveInt(
  value: string | number | undefined,
  flagName: string,
  def: number,
  min = 1,
): number {
  if (value === undefined) return def;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new ValidationError(
      `${flagName} must be an integer >= ${min}, got "${value}"`,
    );
  }
  return n;
}

/**
 * Insertion-ordered Set with a size cap; evicts the oldest entry when full.
 * Used by `workflow watch` so an hours-long session on a busy instance does
 * not accumulate every execution ID it has ever seen.
 */
export class BoundedSet<T> {
  private readonly set = new Set<T>();

  constructor(private readonly maxSize: number) {}

  add(value: T): void {
    if (this.set.has(value)) return;
    if (this.set.size >= this.maxSize) {
      const oldest = this.set.values().next().value as T;
      this.set.delete(oldest);
    }
    this.set.add(value);
  }

  has(value: T): boolean {
    return this.set.has(value);
  }

  get size(): number {
    return this.set.size;
  }
}
