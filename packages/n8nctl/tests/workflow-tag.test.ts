import { describe, it, expect } from 'vitest';
import { parseTagArgs } from '../src/commands/workflow/tag.js';
import { ValidationError } from '../src/lib/errors.js';

describe('v0.4.0 regression: parseTagArgs (commander variadic flatten)', () => {
  it('flattens commander variadic shape: [id, [name1, name2, ...]]', () => {
    // Commander v12 passes <tag-names...> as a single nested array — args[1] is
    // the whole list, NOT individual positionals. Before the fix, args.slice(1)
    // produced [[...]] and the inner loop tried `[...].toLowerCase()`,
    // throwing "name.toLowerCase is not a function".
    const { id, tagNames } = parseTagArgs(['42', ['prod', 'hot']]);
    expect(id).toBe('42');
    expect(tagNames).toEqual(['prod', 'hot']);
  });

  it('also accepts flat shape: [id, name1, name2, ...]', () => {
    const { id, tagNames } = parseTagArgs(['42', 'prod', 'hot']);
    expect(id).toBe('42');
    expect(tagNames).toEqual(['prod', 'hot']);
  });

  it('handles deeply nested arrays defensively', () => {
    const { tagNames } = parseTagArgs(['42', [['a'], ['b', ['c']]]]);
    expect(tagNames).toEqual(['a', 'b', 'c']);
  });

  it('drops empty strings (commander stub args)', () => {
    const { tagNames } = parseTagArgs(['42', ['prod', '', 'hot']]);
    expect(tagNames).toEqual(['prod', 'hot']);
  });

  it('throws when workflow id is missing', () => {
    expect(() => parseTagArgs([])).toThrow(ValidationError);
  });

  it('throws when workflow id is empty', () => {
    expect(() => parseTagArgs(['', ['x']])).toThrow(ValidationError);
  });

  it('throws when no tag names provided', () => {
    expect(() => parseTagArgs(['42', []])).toThrow(/at least one tag/i);
  });

  it('throws when only non-string tag entries provided', () => {
    expect(() => parseTagArgs(['42', [123, null, undefined]])).toThrow(/at least one tag/i);
  });

  it('handles a single tag name (variadic with one element)', () => {
    const { tagNames } = parseTagArgs(['42', ['only-one']]);
    expect(tagNames).toEqual(['only-one']);
  });
});
