#!/usr/bin/env node
// Generate docs/COMMANDS.md from the live Commander tree so the command
// reference never drifts from the code. Run after `npm run build`:
//   node scripts/gen-command-docs.mjs
// (or `--check` to fail if the committed file is stale).
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'packages', 'n8nctl', 'docs', 'COMMANDS.md');

const { buildProgram } = await import(
  pathToFileURL(path.join(here, '..', 'packages', 'n8nctl', 'dist', 'program.js')).href
);

function argSig(cmd) {
  const args = cmd.registeredArguments ?? cmd._args ?? [];
  return args
    .map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
    .join(' ');
}

function optionLines(cmd) {
  return (cmd.options ?? [])
    .filter((o) => !o.hidden)
    .map((o) => `  - \`${o.flags}\` — ${o.description || ''}`.trimEnd());
}

function renderCommand(cmd, prefix) {
  const names = [cmd.name(), ...cmd.aliases()].join(' | ');
  const full = `${prefix}${cmd.name()}`;
  const sig = argSig(cmd);
  const lines = [];
  lines.push(`### \`${full}${sig ? ' ' + sig : ''}\``);
  if (cmd.aliases().length) lines.push(`*aliases: ${cmd.aliases().join(', ')}*`);
  if (cmd.description()) lines.push('', cmd.description());
  const opts = optionLines(cmd);
  if (opts.length) lines.push('', ...opts);
  lines.push('');
  return { names, block: lines.join('\n'), subs: cmd.commands ?? [] };
}

const program = buildProgram();
const out = [
  '# n8nctl — Command Reference',
  '',
  '> Auto-generated from the Commander tree by `scripts/gen-command-docs.mjs`.',
  '> Do not edit by hand — run `node scripts/gen-command-docs.mjs` after changing commands.',
  '',
];

for (const top of program.commands.sort((a, b) => a.name().localeCompare(b.name()))) {
  out.push(`## ${top.name()}${top.aliases().length ? ` (${top.aliases().join(', ')})` : ''}`);
  if (top.description()) out.push('', top.description());
  out.push('');
  const subs = top.commands ?? [];
  if (subs.length === 0) {
    out.push(renderCommand(top, '').block);
  } else {
    for (const sub of subs.sort((a, b) => a.name().localeCompare(b.name()))) {
      out.push(renderCommand(sub, `${top.name()} `).block);
    }
  }
}

const content = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== content) {
    console.error('docs/COMMANDS.md is stale — run `node scripts/gen-command-docs.mjs` and commit.');
    process.exit(1);
  }
  console.log('docs/COMMANDS.md is up to date.');
} else {
  writeFileSync(OUT, content, 'utf8');
  console.log(`Wrote ${OUT}`);
}
