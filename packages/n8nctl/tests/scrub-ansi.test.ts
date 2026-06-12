import { describe, it, expect } from 'vitest';
import { scrubAnsi } from '../src/lib/runtime.js';

/**
 * Regression for the v0.6.0 scrubAnsi upgrade. The pre-0.6.0 regex already
 * stripped the ESC byte itself (0x1B falls inside \x0B-\x1F), so escape
 * sequences could never execute — but the printable sequence BODY survived
 * as residue ("[2J", "]0;title"). 0.6.0 removes the entire sequence.
 */
describe('scrubAnsi', () => {
  it('removes a full CSI clear-screen sequence with no residue', () => {
    expect(scrubAnsi('before \x1b[2J after')).toBe('before  after');
  });

  it('removes SGR color sequences with no residue', () => {
    expect(scrubAnsi('\x1b[31mred\x1b[0m plain')).toBe('red plain');
  });

  it('removes cursor-movement sequences with no residue', () => {
    expect(scrubAnsi('\x1b[10;20Hjump')).toBe('jump');
  });

  it('removes OSC title sequences (BEL-terminated) with no residue', () => {
    expect(scrubAnsi('\x1b]0;evil title\x07text')).toBe('text');
  });

  it('removes OSC sequences terminated by ST (ESC \\)', () => {
    expect(scrubAnsi('\x1b]8;;http://x\x1b\\link')).toBe('link');
  });

  it('removes C1 CSI (0x9B) sequences with no residue', () => {
    expect(scrubAnsi('\x9b2Jtext')).toBe('text');
  });

  it('removes DCS sequences', () => {
    expect(scrubAnsi('\x1bPpayload\x1b\\ok')).toBe('ok');
  });

  it('strips bare C0/C1 control characters', () => {
    expect(scrubAnsi('a\x00b\x08c\x7fd')).toBe('abcd');
  });

  it('preserves tabs, newlines, and Vietnamese text', () => {
    expect(scrubAnsi('lỗi:\tkhông tìm thấy\nworkflow')).toBe('lỗi:\tkhông tìm thấy\nworkflow');
  });

  it('handles a lone trailing ESC without throwing', () => {
    expect(scrubAnsi('text\x1b')).toBe('text');
  });
});
