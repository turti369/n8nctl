import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError, ApiError, AssertionFailedError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { readJsonSource } from '../../lib/stdin.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import { normalizeWorkflow } from '../../lib/normalize.js';
import { autoValidate, type AutoValidateOpts } from '../../lib/auto-validate.js';
import { parsePositiveInt } from '../../lib/util.js';
import {
  verifyExecution,
  parseExpectation,
  expectationFromFlags,
  type Expectation,
  type ExecutionLike,
} from '../../lib/lifecycle/verify.js';
import { webhookProbeTargets, resolveNameMatch } from '../../lib/lifecycle/deploy.js';
import type { Factory } from '../../factory.js';
import type { N8nClient } from '../../lib/api.js';
import type { Workflow } from '../../types/n8n.js';

interface DeployOpts extends AutoValidateOpts {
  id?: string;
  activate?: boolean;
  createOnly?: boolean;
  updateOnly?: boolean;
  run?: boolean;
  trigger?: string;
  expect?: string;
  expectFields?: string;
  maxDurationMs?: string;
  timeout?: string;
  normalize?: boolean;
  verifyTriggers?: boolean;
  rollbackOnFail?: boolean;
  rollbackDeleteCreated?: boolean;
  outDir?: string;
}

async function loadExpectation(opts: DeployOpts): Promise<Expectation | null> {
  const flagExpect = expectationFromFlags({
    expectFields: opts.expectFields,
    maxDurationMs:
      opts.maxDurationMs !== undefined
        ? parsePositiveInt(opts.maxDurationMs, '--max-duration-ms', 0, 1)
        : undefined,
  });
  if (!opts.expect) {
    return flagExpect.fields || flagExpect.maxDurationMs !== undefined || opts.run ? flagExpect : null;
  }
  const abs = path.resolve(opts.expect);
  const raw = await fs.readFile(abs, 'utf8').catch((e) => {
    throw new ValidationError(`Cannot read expectation file ${abs}: ${(e as Error).message}`);
  });
  let doc: unknown;
  try {
    doc = /\.ya?ml$/i.test(abs) ? yaml.load(raw) : JSON.parse(raw);
  } catch (e) {
    throw new ValidationError(`Cannot parse expectation file ${abs}: ${(e as Error).message}`);
  }
  const base = parseExpectation(doc);
  return { ...base, ...(flagExpect.fields ? { fields: flagExpect.fields } : {}) };
}

export async function deployHandler(
  factory: Factory,
  opts: DeployOpts,
  args: string[],
): Promise<void> {
  const [file] = args;
  const { raw, source } = await readJsonSource(file);

  let parsed: Partial<Workflow>;
  try {
    parsed = JSON.parse(raw) as Partial<Workflow>;
  } catch (err) {
    throw new ValidationError(`Invalid JSON in ${source}: ${(err as Error).message}`);
  }

  if (opts.normalize !== false) {
    const { workflow, changes } = normalizeWorkflow(parsed as Workflow);
    parsed = workflow;
    for (const ch of changes) {
      factory.io.event('workflow-normalized', { change: ch }, `${c.dim('→ normalized:')} ${ch}`);
    }
  }

  // A dedicated deploy is fail-closed by default (block at ci) — no
  // backward-compat concern for a new command. --no-validate / --validate-policy override.
  autoValidate(factory, parsed, { validate: opts.validate, validatePolicy: opts.validatePolicy ?? 'ci' });

  const body = stripReadOnlyFields(parsed);
  const name = body.name ?? '(unnamed)';
  const expectation = await loadExpectation(opts);

  const client = await factory.client();
  const auth = await factory.auth();

  // ── Resolve create-or-update target ────────────────────────────────────
  let targetId: string | undefined = opts.id;
  let willCreate = false;
  if (opts.id) {
    const exists = await workflowExists(client, opts.id);
    if (!exists) {
      throw new ValidationError(
        `--id ${opts.id} does not exist on the target`,
        'Omit --id to create by name, or pass an existing workflow ID.',
      );
    }
    if (opts.createOnly) throw new ValidationError('--create-only conflicts with an existing --id');
  } else {
    const matches: Array<{ id: string }> = [];
    for await (const wf of client.paginate<Workflow>('/workflows', {})) {
      if (wf.name === name) matches.push({ id: wf.id });
    }
    const match = resolveNameMatch(matches);
    if (match.kind === 'ambiguous') {
      throw new ValidationError(
        `${match.ids.length} workflows are named "${name}" — refusing to guess which to update`,
        `Pass --id <one of: ${match.ids.join(', ')}> to target one explicitly.`,
      );
    }
    if (match.kind === 'update') {
      if (opts.createOnly) {
        throw new ValidationError(
          `A workflow named "${name}" already exists (${match.id}) and --create-only is set`,
          'Drop --create-only to update it, or rename the workflow.',
        );
      }
      targetId = match.id;
    } else {
      if (opts.updateOnly) {
        throw new ValidationError(`No workflow named "${name}" to update, and --update-only is set`);
      }
      willCreate = true;
    }
  }

  // Snapshot the current state for --rollback-on-fail (update path only).
  let snapshot: Workflow | undefined;
  if (!willCreate && targetId && opts.rollbackOnFail) {
    snapshot = await client.get<Workflow>(`/workflows/${encodeURIComponent(targetId)}`);
  }

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would ${willCreate ? 'CREATE' : `UPDATE ${targetId}`} "${name}"` +
        `${opts.activate ? ' + activate' : ''}${opts.run ? ' + run + verify' : ''} (from ${source})\n`,
    );
    return;
  }

  factory.io.event('workflow-deploy-started', { name, mode: willCreate ? 'create' : 'update', targetId });

  let created = false;
  let deployedId: string | undefined;
  try {
    // ── Create or update ─────────────────────────────────────────────────
    let deployed: Workflow;
    if (willCreate) {
      deployed = await client.post<Workflow>('/workflows', body);
      created = true;
    } else {
      deployed = await client.put<Workflow>(`/workflows/${encodeURIComponent(targetId!)}`, body);
    }
    deployedId = deployed.id;
    factory.io.event(
      'workflow-deploy-step',
      { step: willCreate ? 'created' : 'updated', workflowId: deployedId },
      `${c.green('✓')} ${willCreate ? 'created' : 'updated'} ${c.bold(deployedId)} "${name}"`,
    );

    // ── Activate ─────────────────────────────────────────────────────────
    if (opts.activate && !deployed.active) {
      await client.post<Workflow>(`/workflows/${encodeURIComponent(deployedId)}/activate`);
      factory.io.event('workflow-deploy-step', { step: 'activated', workflowId: deployedId }, `${c.green('✓')} activated ${deployedId}`);
    }

    // ── Trigger-registration check (opt-in: probing FIRES the webhook) ────
    if (opts.activate && opts.verifyTriggers) {
      const full = await client.get<Workflow>(`/workflows/${encodeURIComponent(deployedId)}`);
      const targets = webhookProbeTargets(full.nodes, auth.host);
      for (const t of targets) {
        const { status } = await client.webhookProbe(t.url, {}, { method: t.method });
        if (status === 404) {
          throw new AssertionFailedError(
            `Webhook "${t.nodeName}" is NOT registered (${t.method} ${t.url} → 404) despite active=true`,
            'Self-hosted n8n may not re-register triggers on API activate. Do a UI Save, restart n8n, or run `n8nctl workflow refresh`.',
          );
        }
        factory.io.event('workflow-deploy-step', { step: 'trigger-live', node: t.nodeName, status }, `${c.green('✓')} webhook "${t.nodeName}" live (${status})`);
      }
    }

    // ── Run + verify gate ────────────────────────────────────────────────
    if (opts.run || expectation) {
      const sc = await factory.sessionClient();
      const { executionId } = await sc.runWorkflow(deployedId, opts.trigger);
      factory.io.event('workflow-deploy-step', { step: 'run', workflowId: deployedId, executionId }, `${c.dim('→')} ran execution ${executionId}`);
      const timeoutMs = parsePositiveInt(opts.timeout, '--timeout', 120000);
      await sc.waitExecution(executionId, { timeoutMs });

      const exec = await client.get<ExecutionLike>(`/executions/${encodeURIComponent(executionId)}`, {
        includeData: true,
      });
      const report = verifyExecution(exec, expectation ?? { version: 'v1' });
      await writeArtifacts(opts.outDir, { deployedId, created, report });
      factory.io.event('workflow-deploy-step', { step: 'verify', gate: report.gate, pass: report.pass });
      if (!report.pass) {
        throw new AssertionFailedError(
          `Deploy gate failed (${report.gate}) for execution ${executionId}`,
          report.checks.filter((ch) => ch.status === 'FAIL').map((ch) => ch.msg).join('; ') || undefined,
        );
      }
    } else {
      await writeArtifacts(opts.outDir, { deployedId, created });
    }

    factory.io.event(
      'workflow-deploy-finished',
      { workflowId: deployedId, created, activated: Boolean(opts.activate) },
      `${c.green('✓')} deployed "${name}" → ${c.bold(deployedId)} (${created ? 'created' : 'updated'})`,
    );
    await printData(
      { workflowId: deployedId, name, created, activated: Boolean(opts.activate) },
      { io: factory.io, opts: factory.flags },
    );
  } catch (err) {
    if (opts.rollbackOnFail) {
      await rollbackOnFail(factory, client, {
        created,
        createdId: deployedId ?? (created ? await safeFindByName(client, name) : undefined),
        snapshot,
        deleteCreated: Boolean(opts.rollbackDeleteCreated),
      });
    }
    throw err;
  }
}

async function workflowExists(client: N8nClient, id: string): Promise<boolean> {
  return client
    .get<Workflow>(`/workflows/${encodeURIComponent(id)}`)
    .then(() => true)
    .catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return false;
      throw e;
    });
}

async function safeFindByName(client: N8nClient, name: string): Promise<string | undefined> {
  try {
    for await (const wf of client.paginate<Workflow>('/workflows', {})) {
      if (wf.name === name) return wf.id;
    }
  } catch {
    /* best-effort */
  }
  return undefined;
}

async function rollbackOnFail(
  factory: Factory,
  client: N8nClient,
  ctx: { created: boolean; createdId?: string; snapshot?: Workflow; deleteCreated: boolean },
): Promise<void> {
  try {
    if (ctx.created && ctx.createdId) {
      // A freshly-created workflow: deactivate by default; delete only on demand.
      if (ctx.deleteCreated) {
        await client.delete(`/workflows/${encodeURIComponent(ctx.createdId)}`);
        factory.io.event('workflow-deploy-rolledback', { action: 'deleted', workflowId: ctx.createdId }, `${c.yellow('↩')} rollback: deleted created workflow ${ctx.createdId}`);
      } else {
        await client.post(`/workflows/${encodeURIComponent(ctx.createdId)}/deactivate`).catch(() => undefined);
        factory.io.event('workflow-deploy-rolledback', { action: 'deactivated', workflowId: ctx.createdId }, `${c.yellow('↩')} rollback: deactivated created workflow ${ctx.createdId} (pass --rollback-delete-created to remove it)`);
      }
    } else if (ctx.snapshot) {
      const body = stripReadOnlyFields(ctx.snapshot);
      await client.put(`/workflows/${encodeURIComponent(ctx.snapshot.id)}`, body);
      if (ctx.snapshot.active) {
        await client.post(`/workflows/${encodeURIComponent(ctx.snapshot.id)}/activate`).catch(() => undefined);
      } else {
        await client.post(`/workflows/${encodeURIComponent(ctx.snapshot.id)}/deactivate`).catch(() => undefined);
      }
      factory.io.event('workflow-deploy-rolledback', { action: 'restored', workflowId: ctx.snapshot.id }, `${c.yellow('↩')} rollback: restored workflow ${ctx.snapshot.id} to its pre-deploy state`);
    }
  } catch (rbErr) {
    factory.io.stderr.write(`${c.red('rollback failed')}: ${(rbErr as Error).message} — manual cleanup needed\n`);
  }
}

async function writeArtifacts(
  outDir: string | undefined,
  data: Record<string, unknown>,
): Promise<void> {
  if (!outDir) return;
  const dir = path.resolve(outDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'deploy-report.json'), JSON.stringify(data, null, 2), 'utf8');
}

export function createDeployCommand(): Command {
  return new Command('deploy')
    .description(
      'One-shot deploy: normalize → validate → create-or-update (by name, or --id) → ' +
        'activate → optional trigger-registration check → optional run + verify gate. ' +
        'Exit 3 on validation/ambiguity, 6 on a failed gate or unregistered trigger.',
    )
    .argument('<file>', 'workflow JSON file (or "-" for stdin)')
    .option('--id <id>', 'Update this workflow ID instead of matching by name')
    .option('--create-only', 'Fail if a same-name workflow already exists')
    .option('--update-only', 'Fail if no same-name workflow exists (never create)')
    .option('--activate', 'Activate after deploy')
    .option('--verify-triggers', 'After activate, probe webhook URLs to confirm registration (⚠ fires the webhook once); exit 6 if not registered')
    .option('--run', 'Run the workflow via /rest after deploy, then gate the execution')
    .option('--trigger <name>', 'Trigger node name for --run (non-webhook)')
    .option('--expect <file>', 'Expectation file for the gate (JSON/YAML, version: v1)')
    .option('--expect-fields <a,b,c>', 'Gate: fields required non-null on the last node output')
    .option('--max-duration-ms <n>', 'Gate: execution duration budget in ms')
    .option('--timeout <ms>', 'Wait timeout for --run (default 120000)')
    .option('--no-normalize', 'Skip auto-normalize')
    .option('--no-validate', 'Skip validation')
    .option('--validate-policy <p>', 'Validation policy dev|ci|strict (default ci — deploy blocks on failure)')
    .option('--rollback-on-fail', 'On any post-write failure, restore the previous state (update) or deactivate the new workflow (create)')
    .option('--rollback-delete-created', 'With --rollback-on-fail, DELETE a rolled-back created workflow instead of deactivating it')
    .option('--out-dir <dir>', 'Write a deploy-report.json artifact')
    .action(withAction<DeployOpts>(deployHandler));
}
