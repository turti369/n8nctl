import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

// Aligned with ALLOWED_API_FIELDS (workflow-body.ts): staticData is server-side
// read-only — showing it as a diff item misled users into thinking `workflow
// update` could reconcile it (n8n PUT rejects extra fields with 400).
const DIFF_KEYS = ['name', 'nodes', 'connections', 'settings'] as const;

interface DiffOpts {
  full?: boolean;
}

export function createDiffCommand(): Command {
  return new Command('diff')
    .description('Show differences between a local workflow JSON and the deployed version')
    .argument('<id>', 'workflow ID on server')
    .argument('<file>', 'local JSON file to compare against')
    .option('--full', 'Print full JSON diff instead of summary')
    .action(
      withAction<DiffOpts>(async (factory, opts, args) => {
        const [id, file] = args;
        const absPath = path.resolve(file);

        let local: Workflow;
        try {
          local = JSON.parse(await fs.readFile(absPath, 'utf8')) as Workflow;
        } catch (err) {
          throw new ValidationError(`Cannot parse ${absPath}: ${(err as Error).message}`);
        }

        const client = await factory.client();
        const remote = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);

        const changes = computeDiff(remote, local);

        if (changes.length === 0) {
          factory.io.stdout.write(`${c.green('✓')} no differences — local matches deployed\n`);
          return;
        }

        if (opts.full || factory.flags.json) {
          const fullPayload = {
            workflowId: id,
            remoteName: remote.name,
            localName: local.name,
            changes,
          };
          factory.io.stdout.write(JSON.stringify(fullPayload, null, 2) + '\n');
          return;
        }

        factory.io.stdout.write(`${c.bold('Diff')} ${c.dim(id)}  remote → local\n\n`);
        for (const change of changes) {
          const icon =
            change.kind === 'added' ? c.green('+') : change.kind === 'removed' ? c.red('-') : c.yellow('~');
          factory.io.stdout.write(`  ${icon} ${change.path}: ${change.summary}\n`);
        }
        factory.io.stdout.write(`\n${c.dim(`${changes.length} change(s)`)}\n`);
      }),
    );
}

type Change = {
  kind: 'added' | 'removed' | 'modified';
  path: string;
  summary: string;
};

function computeDiff(remote: Workflow, local: Workflow): Change[] {
  const changes: Change[] = [];

  if (remote.name !== local.name) {
    changes.push({ kind: 'modified', path: 'name', summary: `"${remote.name}" → "${local.name}"` });
  }

  const remoteNodes = new Map((remote.nodes ?? []).map((n) => [n.name, n]));
  const localNodes = new Map((local.nodes ?? []).map((n) => [n.name, n]));

  for (const [name] of remoteNodes) {
    if (!localNodes.has(name)) {
      changes.push({ kind: 'removed', path: `nodes["${name}"]`, summary: 'node removed' });
    }
  }
  for (const [name, node] of localNodes) {
    const r = remoteNodes.get(name);
    if (!r) {
      changes.push({ kind: 'added', path: `nodes["${name}"]`, summary: `new ${node.type}` });
      continue;
    }
    if (r.type !== node.type) {
      changes.push({
        kind: 'modified',
        path: `nodes["${name}"].type`,
        summary: `${r.type} → ${node.type}`,
      });
    }
    if (r.typeVersion !== node.typeVersion) {
      changes.push({
        kind: 'modified',
        path: `nodes["${name}"].typeVersion`,
        summary: `${r.typeVersion} → ${node.typeVersion}`,
      });
    }
    const rParams = JSON.stringify(r.parameters ?? {});
    const lParams = JSON.stringify(node.parameters ?? {});
    if (rParams !== lParams) {
      changes.push({
        kind: 'modified',
        path: `nodes["${name}"].parameters`,
        summary: `${rParams.length} → ${lParams.length} chars`,
      });
    }
  }

  const rConn = JSON.stringify(remote.connections ?? {});
  const lConn = JSON.stringify(local.connections ?? {});
  if (rConn !== lConn) {
    changes.push({
      kind: 'modified',
      path: 'connections',
      summary: `${Object.keys(remote.connections ?? {}).length} → ${Object.keys(local.connections ?? {}).length} source nodes`,
    });
  }

  for (const key of DIFF_KEYS) {
    if (key === 'name' || key === 'nodes' || key === 'connections') continue;
    const r = JSON.stringify((remote as unknown as Record<string, unknown>)[key] ?? null);
    const l = JSON.stringify((local as unknown as Record<string, unknown>)[key] ?? null);
    if (r !== l) {
      changes.push({ kind: 'modified', path: key, summary: 'changed' });
    }
  }

  return changes;
}
