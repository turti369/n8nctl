/**
 * Regression tests for bugs fixed in v0.1.1.
 */
import { describe, it, expect } from 'vitest';
import { validate } from '../src/validator.js';

describe('v0.1.1 regression: null-guard for nodes[i]', () => {
  it('does not throw when nodes array contains null', () => {
    const result = validate({
      name: 'test',
      nodes: [null, null],
      connections: {},
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'E009')).toBe(true);
  });

  it('does not throw when nodes array contains non-object (string, number)', () => {
    const result = validate({
      name: 'test',
      nodes: ['not an object', 42],
      connections: {},
    });
    expect(result.valid).toBe(false);
    expect(result.issues.filter((i) => i.code === 'E009').length).toBe(2);
  });

  it('does not throw when nodes array contains mix of null and valid nodes', () => {
    const result = validate({
      name: 'test',
      nodes: [
        null,
        {
          id: 'a',
          name: 'Valid',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
      ],
      connections: {},
    });
    expect(result.issues.some((i) => i.code === 'E009')).toBe(true);
    // Valid node should still be evaluated
    expect(result.issues.filter((i) => i.severity === 'HIGH' && i.code !== 'E009').length).toBe(0);
  });

  it('does not throw when nodes array contains arrays (nested)', () => {
    const result = validate({
      name: 'test',
      nodes: [['nested', 'array']],
      connections: {},
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'E009')).toBe(true);
  });
});
