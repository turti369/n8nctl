import { describe, it, expect } from 'vitest';
import { sleep, parsePositiveInt, BoundedSet } from '../src/lib/util.js';
import { ValidationError } from '../src/lib/errors.js';

describe('parsePositiveInt', () => {
  it('returns the default when value is undefined', () => {
    expect(parsePositiveInt(undefined, '--limit', 20)).toBe(20);
  });

  it('parses a valid positive integer string', () => {
    expect(parsePositiveInt('42', '--limit', 20)).toBe(42);
  });

  it('passes through a number value (commander coercer already ran)', () => {
    expect(parsePositiveInt(500, '--delay', 100)).toBe(500);
  });

  it('throws ValidationError on non-numeric input instead of sending NaN to the API', () => {
    expect(() => parsePositiveInt('abc', '--limit', 20)).toThrow(ValidationError);
    expect(() => parsePositiveInt('abc', '--limit', 20)).toThrow(/--limit/);
  });

  it('throws ValidationError on zero and negative values', () => {
    expect(() => parsePositiveInt('0', '--timeout', 1000)).toThrow(ValidationError);
    expect(() => parsePositiveInt('-5', '--timeout', 1000)).toThrow(ValidationError);
  });

  it('throws ValidationError on non-integer values', () => {
    expect(() => parsePositiveInt('1.5', '--limit', 20)).toThrow(ValidationError);
  });

  it('throws ValidationError on NaN number input', () => {
    expect(() => parsePositiveInt(Number.NaN, '--timeout', 1000)).toThrow(ValidationError);
  });
});

describe('sleep', () => {
  it('resolves and clamps negative durations to zero', async () => {
    const t0 = Date.now();
    await sleep(-100);
    expect(Date.now() - t0).toBeLessThan(50);
  });
});

describe('BoundedSet', () => {
  it('behaves like a set under the cap', () => {
    const s = new BoundedSet<string>(3);
    s.add('a');
    s.add('b');
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(true);
    expect(s.has('c')).toBe(false);
  });

  it('evicts the oldest entry when the cap is exceeded', () => {
    const s = new BoundedSet<string>(3);
    s.add('a');
    s.add('b');
    s.add('c');
    s.add('d'); // evicts 'a'
    expect(s.has('a')).toBe(false);
    expect(s.has('b')).toBe(true);
    expect(s.has('d')).toBe(true);
    expect(s.size).toBe(3);
  });

  it('does not grow or evict on duplicate adds', () => {
    const s = new BoundedSet<string>(2);
    s.add('a');
    s.add('a');
    s.add('a');
    s.add('b');
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(true);
    expect(s.size).toBe(2);
  });
});
