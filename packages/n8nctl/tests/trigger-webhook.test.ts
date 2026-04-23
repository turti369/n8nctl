import { describe, it, expect } from 'vitest';
import { encodePathSegments } from '../src/commands/workflow/trigger-webhook.js';

describe('Tier B #4: encodePathSegments', () => {
  it('preserves single-segment paths', () => {
    expect(encodePathSegments('my-endpoint')).toBe('my-endpoint');
  });

  it('preserves multi-segment paths — slashes remain structural', () => {
    expect(encodePathSegments('api/users')).toBe('api/users');
    expect(encodePathSegments('v1/events/incoming')).toBe('v1/events/incoming');
  });

  it('encodes unsafe characters within a segment', () => {
    expect(encodePathSegments('with space')).toBe('with%20space');
    expect(encodePathSegments('a/with space/b')).toBe('a/with%20space/b');
  });

  it('encodes Vietnamese / unicode segments', () => {
    const result = encodePathSegments('đơn-hàng/mới');
    expect(result).toContain('/');
    // All non-ASCII chars encoded
    expect(result).toMatch(/^[%0-9A-Za-z\-/]+$/);
  });

  it('strips leading and trailing slashes', () => {
    expect(encodePathSegments('/path/')).toBe('path');
    expect(encodePathSegments('///a/b///')).toBe('a/b');
  });

  it('does NOT escape "/" as "%2F" (regression — was the old bug)', () => {
    expect(encodePathSegments('api/users')).not.toContain('%2F');
  });
});
