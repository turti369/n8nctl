#!/usr/bin/env node
// Cold-start micro-benchmark for the CLI. Spawns `node dist/index.js <args>`
// repeatedly and reports the wall-clock startup distribution. Used to measure
// the effect of lazy-loading heavy formatter/prompt deps (table, handlebars,
// node-jq, inquirer) off the hot path.
//
// Usage:
//   node scripts/bench-startup.mjs                 # default: --version, 20 runs
//   node scripts/bench-startup.mjs --runs 30 -- --help
//   node scripts/bench-startup.mjs -- workflow --help
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'packages', 'n8nctl', 'dist', 'index.js');

const argv = process.argv.slice(2);
let runs = 20;
const sep = argv.indexOf('--');
const cliArgs = sep === -1 ? ['--version'] : argv.slice(sep + 1);
const opts = sep === -1 ? argv : argv.slice(0, sep);
const ri = opts.indexOf('--runs');
if (ri !== -1) runs = Number(opts[ri + 1]) || runs;

const WARMUP = 3;
const samples = [];
for (let i = 0; i < runs + WARMUP; i++) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [CLI, ...cliArgs], { stdio: 'ignore' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.status !== 0 && !cliArgs.includes('--help') && cliArgs[0] !== '--version') {
    // non-zero is fine for --help/--version; otherwise surface it once
    if (i === 0) console.error(`warn: exit ${r.status} for \`${cliArgs.join(' ')}\``);
  }
  if (i >= WARMUP) samples.push(ms);
}

samples.sort((a, b) => a - b);
const pct = (p) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

console.log(`cmd:    node dist/index.js ${cliArgs.join(' ')}`);
console.log(`runs:   ${samples.length} (after ${WARMUP} warmup)`);
console.log(`min:    ${samples[0].toFixed(1)} ms`);
console.log(`median: ${pct(50).toFixed(1)} ms`);
console.log(`mean:   ${mean.toFixed(1)} ms`);
console.log(`p90:    ${pct(90).toFixed(1)} ms`);
console.log(`max:    ${samples[samples.length - 1].toFixed(1)} ms`);
