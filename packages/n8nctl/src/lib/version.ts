import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Resolves to packages/n8nctl/package.json from both src/lib (tests, tsx) and
// dist/lib (compiled output) — both sit two levels below the package root.
const pkg = require('../../package.json') as { version: string };

export const VERSION: string = pkg.version;

/**
 * Single source for the HTTP User-Agent. Was previously hardcoded in api.ts
 * and session-api.ts, with a third stale copy ('n8nctl/0.4.0') in doctor.ts —
 * deriving from package.json removes the manual bump step entirely.
 */
export const USER_AGENT = `n8nctl/${VERSION}`;
