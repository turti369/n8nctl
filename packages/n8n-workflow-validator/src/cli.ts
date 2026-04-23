#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { validate } from './validator.js';

function main(): void {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: n8n-validate <workflow.json> [--strict]');
    process.exit(2);
  }

  const strict = process.argv.includes('--strict');
  const filePath = path.resolve(arg);

  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }

  let wf: unknown;
  try {
    wf = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Invalid JSON: ${(e as Error).message}`);
    process.exit(1);
  }

  const result = validate(wf, { strict });

  if (result.valid && result.issues.length === 0) {
    console.log(`✓ ${path.basename(filePath)} passed validation (${result.nodeCount} nodes)`);
    process.exit(0);
  }

  if (result.issues.length > 0) {
    console.error('\n❌ VALIDATION FAILED\n');
    result.issues.forEach((e, i) => {
      console.error(`  ${i + 1}. [${e.severity}] ${e.code}: ${e.msg}`);
    });
    console.error(`\nTotal: ${result.issues.length} issue(s)\n`);
  }

  process.exit(result.valid ? 0 : 1);
}

main();
