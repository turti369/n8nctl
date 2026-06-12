import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { VERSION, USER_AGENT } from '../src/lib/version.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

// Regression: USER_AGENT was hardcoded in api.ts + session-api.ts and a stale
// third copy ('n8nctl/0.4.0') shipped in doctor.ts. Single source kills the class.
describe('version single source', () => {
  it('VERSION matches package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('USER_AGENT is derived from package.json version', () => {
    expect(USER_AGENT).toBe(`n8nctl/${pkg.version}`);
  });
});
