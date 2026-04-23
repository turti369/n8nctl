import { describe, it, expect } from 'vitest';
import { validate } from '../src/validator.js';

function wfWithString(s: string) {
  return {
    name: 't',
    nodes: [
      {
        id: 'a',
        name: 'N',
        type: 'n8n-nodes-base.set',
        typeVersion: 3,
        position: [0, 0],
        parameters: { leakedValue: s, assignments: {} },
      },
    ],
    connections: {},
  };
}

// Test fixtures below are synthesized at runtime to avoid tripping static
// secret scanners (GitHub push protection, gitleaks, trufflehog). Each
// fixture is assembled from pieces so no literal token-shaped string exists
// in source. The runtime strings still exercise every regex in validator.ts.
const join = (...parts: string[]): string => parts.join('');

describe('v0.2.0 secret patterns (Tier A #1)', () => {
  const cases: Array<[string, string]> = [
    ['Bearer token', join('Authorization: Bearer ', 'abcdef1234567890abcdef1234')],
    ['JWT', join('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')],
    ['AWS access key', join('AKIA', 'IOSFODNN7EXAMPLE')],
    ['AWS session token', join('ASIA', 'IOSFODNN7EXAMPLE')],
    ['Google API key', join('AIza', 'SyDqWFqN9XvQUgHI8QD_5LqFxRDkD5w9c2A')],
    ['Slack token', join('xox', 'b', '-', '1234567890', '-', 'abcdefghijklmnop')],
    ['GitHub PAT (classic)', join('ghp', '_', '0123456789abcdefghijklmnopqrstuv0123')],
    ['GitHub OAuth token', join('gho', '_', '0123456789abcdefghijklmnopqrstuv0123')],
    ['GitHub user-to-server', join('ghu', '_', '0123456789abcdefghijklmnopqrstuv0123')],
    ['GitHub server-to-server', join('ghs', '_', '0123456789abcdefghijklmnopqrstuv0123')],
    ['GitHub refresh token', join('ghr', '_', '0123456789abcdefghijklmnopqrstuv0123')],
    ['Stripe live secret key', join('sk', '_live_', 'aAbBcCdDeEfFgGhHiIjJkKlLmM')],
    ['Stripe live restricted key', join('rk', '_live_', 'aAbBcCdDeEfFgGhHiIjJkKlLmM')],
    ['OpenAI API key', join('sk', '-proj-', 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ')],
    ['Anthropic API key', join('sk', '-ant-api03-', 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH')],
    ['PEM private key', join('-----', 'BEGIN RSA PRIVATE KEY', '-----\nfoo\n-----', 'END RSA PRIVATE KEY', '-----')],
    ['PEM private key (generic)', join('-----', 'BEGIN PRIVATE KEY', '-----\nfoo\n-----', 'END PRIVATE KEY', '-----')],
    ['SSH private key header', join('-----', 'BEGIN OPENSSH PRIVATE KEY', '-----\n...')],
  ];

  for (const [label, value] of cases) {
    it(`detects ${label}`, () => {
      const r = validate(wfWithString(value));
      const hit = r.issues.find((i) => i.code === 'E050');
      expect(hit, `expected E050 for ${label}`).toBeDefined();
    });
  }

  it('does NOT flag innocent strings that look similar', () => {
    const innocentCases = [
      'https://api.example.com/v1/users',
      'AKIA',
      'sk-',
      '-----BEGIN CERTIFICATE-----',
    ];
    for (const s of innocentCases) {
      const r = validate(wfWithString(s));
      expect(r.issues.some((i) => i.code === 'E050'), `false positive on "${s}"`).toBe(false);
    }
  });
});
