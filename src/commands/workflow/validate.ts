import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';

interface ValidateOpts {
  strict?: boolean;
}

export function createValidateCommand(): Command {
  return new Command('validate')
    .description('Validate a workflow JSON file locally (schema, references, expressions, secrets)')
    .argument('<file>', 'path to workflow JSON file')
    .option('--strict', 'Fail on MEDIUM-severity issues too')
    .action(
      withAction<ValidateOpts>(async (factory, opts, args) => {
        const [file] = args;
        const absPath = path.resolve(file);
        const raw = await fs.readFile(absPath, 'utf8').catch((e) => {
          throw new ValidationError(`Cannot read ${absPath}: ${e.message}`);
        });

        let wf: unknown;
        try {
          wf = JSON.parse(raw);
        } catch (e) {
          throw new ValidationError(`Invalid JSON: ${(e as Error).message}`);
        }

        const errors = runChecks(wf);

        if (errors.length === 0) {
          const nodeCount = Array.isArray((wf as { nodes?: unknown[] }).nodes)
            ? (wf as { nodes: unknown[] }).nodes.length
            : 0;
          factory.io.stdout.write(
            `${c.green('✓')} ${path.basename(absPath)} passed validation (${nodeCount} nodes)\n`,
          );
          return;
        }

        const blocking = errors.filter(
          (e) => e.severity === 'CRITICAL' || e.severity === 'HIGH' || (opts.strict && e.severity === 'MEDIUM'),
        );

        factory.io.stderr.write(`\n${c.red('✗ VALIDATION FAILED')}\n\n`);
        errors.forEach((e, i) => {
          const color = e.severity === 'CRITICAL' ? c.red : e.severity === 'HIGH' ? c.yellow : c.dim;
          factory.io.stderr.write(`  ${i + 1}. ${color(`[${e.severity}]`)} ${e.code}: ${e.msg}\n`);
        });
        factory.io.stderr.write(`\nTotal: ${errors.length} issue(s)\n`);

        if (blocking.length > 0) {
          throw new ValidationError(`${blocking.length} blocking issue(s) found`);
        }
      }),
    );
}

interface Issue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  code: string;
  msg: string;
}

function runChecks(wf: unknown): Issue[] {
  const errors: Issue[] = [];
  const push = (severity: Issue['severity'], code: string, msg: string) =>
    errors.push({ severity, code, msg });

  if (typeof wf !== 'object' || wf === null) {
    push('CRITICAL', 'E001', 'Workflow is not a JSON object');
    return errors;
  }
  const w = wf as Record<string, unknown>;
  if (!Array.isArray(w.nodes)) push('CRITICAL', 'E002', 'Missing or invalid "nodes" array');
  if (typeof w.connections !== 'object' || w.connections === null) {
    push('CRITICAL', 'E003', 'Missing or invalid "connections" object');
  }
  if (typeof w.name !== 'string' || !(w.name as string).trim()) {
    push('HIGH', 'E004', 'Workflow must have non-empty "name"');
  }
  if (errors.some((e) => e.severity === 'CRITICAL')) return errors;

  const nodes = w.nodes as Array<Record<string, unknown>>;
  const nodeNames = new Set<string>();
  nodes.forEach((node, idx) => {
    const tag = `nodes[${idx}]${node.name ? ` "${node.name as string}"` : ''}`;
    if (!node.name || typeof node.name !== 'string') push('HIGH', 'E012', `${tag} missing "name"`);
    else {
      if (nodeNames.has(node.name)) push('HIGH', 'E013', `${tag} duplicate name`);
      nodeNames.add(node.name);
    }
    if (!node.type || typeof node.type !== 'string') push('HIGH', 'E014', `${tag} missing "type"`);
    if (typeof node.typeVersion !== 'number') push('HIGH', 'E016', `${tag} "typeVersion" must be number`);
  });

  // secret patterns
  const raw = JSON.stringify(wf);
  const secretPatterns = [
    { name: 'Bearer token', re: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/ },
    { name: 'AWS key', re: /AKIA[0-9A-Z]{16}/ },
    { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  ];
  for (const p of secretPatterns) {
    const m = raw.match(p.re);
    if (m) push('CRITICAL', 'E050', `hardcoded ${p.name}: ${m[0].slice(0, 30)}...`);
  }

  return errors;
}
