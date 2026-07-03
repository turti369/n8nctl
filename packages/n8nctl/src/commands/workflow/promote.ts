import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { ValidationError, ApiError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import { computeDiff } from './diff.js';
import {
  planPromotion,
  parseMapFile,
  formatMappingReport,
  type TargetCredential,
} from '../../lib/lifecycle/promote.js';
import type { Factory } from '../../factory.js';
import type { N8nClient } from '../../lib/api.js';
import type { Workflow } from '../../types/n8n.js';

interface PromoteOpts {
  to?: string;
  from?: string;
  map?: string;
  activate?: boolean;
  allowUnmapped?: boolean;
  outDir?: string;
  byName?: boolean;
}

interface NodeWithCreds {
  credentials?: Record<string, { id?: string; name?: string }>;
}

type FullWorkflow = Workflow & { nodes?: NodeWithCreds[] };

/** Max parallel detail fetches when scanning a target instance (mirrors export-all). */
const TARGET_SCAN_CONCURRENCY = 8;

/**
 * Fetch every FULL workflow on an instance in a single pass: paginate the list
 * once, then fetch details with a bounded worker pool. Both credential
 * derivation and same-name lookup are then served from this one in-memory set,
 * replacing the previous TWO full `/workflows` scans + sequential per-workflow
 * GETs (O(N) sequential → one list + N parallel).
 */
async function collectTargetWorkflows(client: N8nClient): Promise<FullWorkflow[]> {
  const summaries: Workflow[] = [];
  for await (const wf of client.paginate<Workflow>('/workflows', {})) summaries.push(wf);

  const full: FullWorkflow[] = [];
  const queue = [...summaries];
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const wf = queue.shift();
      if (!wf) return;
      full.push(await client.get<FullWorkflow>(`/workflows/${encodeURIComponent(wf.id)}`));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(TARGET_SCAN_CONCURRENCY, queue.length || 1) }, worker),
  );
  return full;
}

/**
 * Derive the universe of credentials in use on the target from its workflow
 * nodes. n8n's Public API has NO GET /credentials list endpoint, so this is the
 * only way to discover {id, name, type} of credentials on target. Pure over an
 * already-collected workflow set.
 */
function deriveTargetCredentials(workflows: FullWorkflow[]): TargetCredential[] {
  const seen = new Map<string, TargetCredential>();
  for (const full of workflows) {
    for (const node of full.nodes ?? []) {
      if (!node.credentials) continue;
      for (const [type, ref] of Object.entries(node.credentials)) {
        if (ref?.id) {
          seen.set(`${type}::${ref.id}`, { id: ref.id, name: ref.name ?? '(unknown)', type });
        }
      }
    }
  }
  return [...seen.values()];
}

export async function promoteHandler(
  factory: Factory,
  opts: PromoteOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  if (!opts.to) {
    throw new ValidationError('--to <profile> is required', 'Specify the destination profile.');
  }

  const sourceClient = opts.from
    ? await factory.clientForProfile(opts.from)
    : await factory.client();
  const targetClient = await factory.clientForProfile(opts.to);

  // 1. Fetch source workflow.
  const source = await sourceClient.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);

  // 2. Load map file (if any) + derive target credentials.
  let mapEntries = undefined;
  if (opts.map) {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(path.resolve(opts.map), 'utf8'));
    } catch (err) {
      throw new ValidationError(`Cannot read/parse map file ${opts.map}: ${(err as Error).message}`);
    }
    mapEntries = parseMapFile(raw);
  }
  // Single pass over the target instance: one list + bounded-parallel detail
  // fetch, reused for both credential derivation and the same-name lookup below.
  const targetWorkflows = await collectTargetWorkflows(targetClient);
  const targetCredentials = deriveTargetCredentials(targetWorkflows);

  // 3. Plan the credential remap (pure).
  const plan = planPromotion(source, targetCredentials, mapEntries);

  // Report (redacted) up front.
  factory.io.stdout.write(`${c.bold('Credential mapping')} (source → ${opts.to}):\n`);
  factory.io.stdout.write(formatMappingReport(plan) + '\n');

  // 4. Gate on unresolved. --allow-unmapped only forgives 'missing' (keeps the
  //    source ref); 'ambiguous' ALWAYS blocks (silent mis-binding risk).
  const ambiguous = plan.unresolved.filter((u) => u.kind === 'ambiguous');
  const missing = plan.unresolved.filter((u) => u.kind === 'missing');
  if (ambiguous.length > 0) {
    throw new ValidationError(
      `${ambiguous.length} credential reference(s) match MULTIPLE target credentials — refusing to guess`,
      'Add an explicit map entry (type+name+targetId) for each. --allow-unmapped does NOT cover ambiguous matches.',
    );
  }
  if (missing.length > 0 && !opts.allowUnmapped) {
    throw new ValidationError(
      `${missing.length} credential reference(s) have no match on ${opts.to}`,
      'Provide --map <file> with targetId for each, or pass --allow-unmapped to keep the source references (they will likely fail at runtime).',
    );
  }

  // 5. Diff against an existing same-name workflow on target (create or update).
  //    Served from the single pass above — no second scan.
  const existing = targetWorkflows.find((w) => w.name === source.name);
  const body = stripReadOnlyFields(plan.workflow);

  const changes = existing ? computeDiff(existing, plan.workflow) : [];
  if (existing) {
    factory.io.stdout.write(
      `\n${c.bold('Target diff')} (${existing.id} "${source.name}"): ${changes.length} change(s)\n`,
    );
  } else {
    factory.io.stdout.write(`\n${c.dim('Target has no workflow named')} "${source.name}" — will CREATE\n`);
  }

  // 6. Artifacts for harness-style gating.
  if (opts.outDir) {
    const dir = path.resolve(opts.outDir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'promoted-workflow.json'), JSON.stringify(plan.workflow, null, 2), 'utf8');
    await fs.writeFile(
      path.join(dir, 'mapping-report.json'),
      JSON.stringify({ mappings: plan.mappings, unresolved: plan.unresolved }, null, 2),
      'utf8',
    );
    await fs.writeFile(path.join(dir, 'target-diff.json'), JSON.stringify(changes, null, 2), 'utf8');
    factory.io.stderr.write(`${c.dim('→')} artifacts written to ${dir}\n`);
  }

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `\n${c.yellow('[dry-run]')} would ${existing ? `update ${existing.id}` : 'create'} on ${opts.to}${opts.activate ? ' + activate' : ''}\n`,
    );
    return;
  }

  // 7. Create or update on target.
  let result: Workflow;
  if (existing) {
    result = await targetClient.put<Workflow>(`/workflows/${encodeURIComponent(existing.id)}`, body);
  } else {
    result = await targetClient.post<Workflow>('/workflows', body);
  }

  factory.io.event(
    'workflow-promoted',
    { sourceId: id, targetId: result.id, to: opts.to, created: !existing, mappings: plan.mappings.length },
    `${c.green('✓')} promoted "${source.name}" → ${opts.to} (${existing ? 'updated' : 'created'} ${result.id})`,
  );
  factory.io.stdout.write(
    `${c.green('✓')} promoted "${source.name}" → ${opts.to}: ${existing ? 'updated' : 'created'} ${c.bold(result.id)}\n`,
  );

  if (opts.activate && !result.active) {
    try {
      await targetClient.post<Workflow>(`/workflows/${encodeURIComponent(result.id)}/activate`);
      factory.io.stdout.write(`${c.green('✓')} activated ${result.id} on ${opts.to}\n`);
    } catch (err) {
      if (err instanceof ApiError) {
        factory.io.stderr.write(
          `${c.yellow('warning')}: promoted but could not activate (${err.message}) — activate manually\n`,
        );
      } else {
        throw err;
      }
    }
  }
}

export function createPromoteCommand(): Command {
  return new Command('promote')
    .description(
      'Promote a workflow to another instance (dev → prod). Remaps credential ' +
        'references to the TARGET instance: auto-matches by type+name ONLY when ' +
        'exactly one target credential matches; ambiguous/missing refs block ' +
        '(no silent mis-binding). Sends only the 4-field whitelist.',
    )
    .argument('<id>', 'workflow ID on the source instance')
    .requiredOption('--to <profile>', 'destination profile (n8nctl profile name)')
    .option('--from <profile>', 'source profile (default: the active/--profile instance)')
    .option('--map <file>', 'credential mapping file (JSON array: {sourceId|type+name, targetId})')
    .option('--allow-unmapped', 'proceed even if some credentials have NO target match (keeps source refs; ambiguous still blocks)')
    .option('--out-dir <dir>', 'write promoted JSON + mapping report + target diff as artifacts')
    .option('--activate', 'activate the workflow on the target after promotion')
    .action(withAction<PromoteOpts>(promoteHandler));
}
