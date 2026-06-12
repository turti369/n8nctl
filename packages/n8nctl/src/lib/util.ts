import { ValidationError } from './errors.js';

/** Shared sleep — clamps negative durations (was copy-pasted in 5 files). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Parse a numeric CLI flag value (--limit, --timeout, --delay, ...).
 * `Number('abc')` is NaN and used to be sent to the n8n API verbatim as the
 * string "NaN"; this guard turns that into a ValidationError (exit 3) instead.
 * Returns `def` when the flag was not passed.
 */
export function parsePositiveInt(
  value: string | number | undefined,
  flagName: string,
  def: number,
): number {
  if (value === undefined) return def;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError(
      `${flagName} must be a positive integer, got "${value}"`,
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
