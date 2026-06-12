import { describe, it, expect } from 'vitest';
import { validateOutputOptions, renderTemplate } from '../src/lib/output.js';
import { ValidationError } from '../src/lib/errors.js';

describe('renderTemplate', () => {
  it('renders defined properties', () => {
    expect(renderTemplate('{{name}} ({{id}})', { name: 'wf', id: '42' })).toBe('wf (42)');
  });

  it('exposes the json helper', () => {
    expect(renderTemplate('{{json v}}', { v: { a: 1 } })).toBe('{\n  "a": 1\n}');
  });

  // strict:true contract (documented in the renderTemplate JSDoc): a typo'd
  // field must throw, not silently render an empty string.
  it('throws ValidationError on an undefined property reference (strict mode)', () => {
    expect(() => renderTemplate('{{nonexistent}}', { name: 'wf' })).toThrow(ValidationError);
  });

  it('throws ValidationError on a nested undefined reference', () => {
    expect(() => renderTemplate('{{meta.missing}}', { meta: {} })).toThrow(ValidationError);
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
