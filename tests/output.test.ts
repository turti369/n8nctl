import { describe, it, expect } from 'vitest';
import { validateOutputOptions } from '../src/lib/output.js';
import { ValidationError } from '../src/lib/errors.js';

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
