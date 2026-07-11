import { Command } from 'commander';
import { withAction } from '../lib/runtime.js';
import { readConfig } from '../lib/config.js';
import { isKeyringAvailable } from '../lib/keyring.js';
import { c } from '../lib/io.js';
import { AuthError } from '../lib/errors.js';
import { fetchAllTags } from '../lib/tags.js';
import type { N8nClient } from '../lib/api.js';
import type { WorkflowTag } from '../types/n8n.js';
import type { Factory } from '../factory.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  /**
   * Machine-readable fix: the exact command/action an agent should run to
   * resolve this check. Doctor itself never mutates (no --fix by design —
   * the asymmetric risk of auto-mutating config/keyring outweighs the
   * convenience; agents execute remediation under their own confirm policy).
   */
  remediation?: string;
}

/**
 * Fixed probe-tag name. Reused across runs so a key that lacks DELETE scope
 * leaves at most ONE leftover tag instead of accumulating a new random tag
 * every `doctor` invocation.
 */
const PROBE_NAME = 'n8nctl-doctor-probe';

/**
 * Identify tags created by doctor's write-probe so we can reuse / clean them
 * without touching user-owned tags. Matches:
 *   - the fixed name `n8nctl-doctor-probe`
 *   - legacy random-suffix probes from <=0.4.0: `n8nctl-` + 12 base36 chars
 *
 * Deliberately strict (exactly 12 trailing chars) so a user's own tag like
 * `n8nctl-prod` or `n8nctl-deploy` is never mistaken for a probe.
 */
export function isProbeTag(name: string): boolean {
  return name === PROBE_NAME || /^n8nctl-[a-z0-9]{12}$/.test(name);
}

export interface WriteProbeOutcome {
  write: CheckResult;
  delete?: CheckResult;
}

/**
 * Probe write + delete permission on /tags WITHOUT accumulating garbage tags.
 *
 * Strategy:
 *   1. List tags; find any leftover probe tags from prior runs.
 *   2. If a probe tag already exists, write permission was proven earlier —
 *      reuse it (do NOT create another). This is what stops the tag-rác leak.
 *   3. Otherwise POST a single fixed-name probe tag to verify create scope.
 *   4. Best-effort DELETE every probe tag found (new + legacy leftovers):
 *      - full-scope key → ends with zero probe tags (also cleans history)
 *      - create-only key → keeps the reused set, never grows it
 */
export async function probeWritePermission(client: N8nClient): Promise<WriteProbeOutcome> {
  let existing: WorkflowTag[] = [];
  try {
    const all = await fetchAllTags(client);
    existing = all.filter(
      (t): t is WorkflowTag => typeof t?.name === 'string' && isProbeTag(t.name),
    );
  } catch {
    // If we can't list, fall through to a create attempt below.
  }

  const probeIds = new Set<string>();
  let write: CheckResult;

  if (existing.length > 0) {
    existing.forEach((t) => probeIds.add(t.id));
    write = {
      name: 'Write permission (POST /tags)',
      status: 'ok',
      detail: 'read-write API key (reused existing probe tag — no new tag created)',
    };
  } else {
    try {
      const created = await client.post<{ id: string; name: string }>('/tags', {
        name: PROBE_NAME,
      });
      if (created?.id) probeIds.add(created.id);
      write = {
        name: 'Write permission (POST /tags)',
        status: 'ok',
        detail: 'read-write API key',
      };
    } catch (err) {
      const msg = (err as Error).message;
      const looks403 = /403|forbidden/i.test(msg);
      return {
        write: {
          name: 'Write permission',
          status: looks403 ? 'fail' : 'warn',
          detail: looks403
            ? 'API key is READ-ONLY — destructive commands will fail mid-pipeline'
            : msg,
        },
      };
    }
  }

  // Best-effort cleanup. Stop on the first delete failure: a missing DELETE
  // scope fails identically for every tag, so retrying is wasted calls.
  let deleted = 0;
  let deleteErr: string | null = null;
  for (const id of probeIds) {
    try {
      await client.delete(`/tags/${encodeURIComponent(id)}`);
      deleted++;
    } catch (err) {
      deleteErr = (err as Error).message;
      break;
    }
  }

  const remaining = probeIds.size - deleted;
  if (!deleteErr) {
    return {
      write,
      delete: {
        name: 'Delete permission (DELETE /tags/:id)',
        status: 'ok',
        detail: 'full read-write-delete',
      },
    };
  }

  const looks403 = /403|forbidden/i.test(deleteErr);
  return {
    write,
    delete: {
      name: 'Delete permission',
      status: 'warn',
      detail: looks403
        ? `API key can CREATE but not DELETE tags — ${remaining} probe tag(s) remain ` +
          `(name "${PROBE_NAME}"); remove via n8n UI or grant tag:delete scope`
        : `probe cleanup failed: ${deleteErr}; ${remaining} probe tag(s) remain`,
    },
  };
}

interface VerboseStats {
  serverVersion?: string;
  latencyP50Ms?: number;
  latencySamplesMs?: number[];
  workflowsTotal?: number;
  workflowsActive?: number;
  executionsLast24hCount?: number;
  executionsLast24hFailureRate?: number;
  rateLimitRemaining?: string;
  rateLimitReset?: string;
}

interface DoctorOpts {
  verbose?: boolean;
}

// ── Per-check functions (each returns its CheckResult(s); no I/O beyond HTTP) ──

function checkNodeVersion(): CheckResult {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  return {
    name: 'Node.js version',
    status: major >= 20 ? 'ok' : 'fail',
    detail: `${nodeVersion} (required: >=20)`,
  };
}

async function checkConfigFile(): Promise<CheckResult> {
  try {
    const cfg = await readConfig();
    const profileCount = Object.keys(cfg.profiles).length;
    return {
      name: 'Config file',
      status: 'ok',
      detail: `${profileCount} profile(s), active: ${cfg.activeProfile ?? 'none'}`,
    };
  } catch (err) {
    return { name: 'Config file', status: 'fail', detail: (err as Error).message };
  }
}

async function checkKeyring(): Promise<CheckResult> {
  const keyring = await isKeyringAvailable();
  return {
    name: 'OS keyring (keytar)',
    status: keyring ? 'ok' : 'warn',
    detail: keyring ? 'available' : 'unavailable — credentials fall back to plaintext config',
    ...(keyring ? {} : { remediation: 'Install/enable the OS credential store, then re-run `n8nctl auth login`' }),
  };
}

function checkEnvVars(): CheckResult {
  const envSet = Boolean(process.env.N8N_API_KEY && process.env.N8N_HOST);
  return {
    name: 'Env vars (N8N_API_KEY + N8N_HOST)',
    status: envSet ? 'ok' : 'warn',
    detail: envSet ? 'set' : 'not set — using profile-based auth',
    ...(envSet ? {} : { remediation: 'export N8N_HOST + N8N_API_KEY, or configure a profile: `n8nctl auth login`' }),
  };
}

async function checkApiConnectivity(client: N8nClient): Promise<CheckResult> {
  try {
    await client.get('/workflows', { limit: 1 });
    return {
      name: 'API connectivity (GET /workflows)',
      status: 'ok',
      detail: 'reachable + authenticated',
    };
  } catch (err) {
    return {
      name: 'API connectivity',
      status: 'fail',
      detail: (err as Error).message,
      remediation: 'Check N8N_HOST is reachable and the API key is valid: `n8nctl auth status`',
    };
  }
}

/** Read-permission probe on an endpoint; failure is a warn, not a fail. */
async function checkReadPermission(
  client: N8nClient,
  endpoint: string,
  label: string,
): Promise<CheckResult> {
  try {
    await client.get(endpoint, { limit: 1 });
    return { name: `${label} (GET ${endpoint})`, status: 'ok', detail: 'available' };
  } catch (err) {
    return { name: label, status: 'warn', detail: (err as Error).message };
  }
}

/**
 * License-feature probes (read-only): Variables and Projects are paid n8n
 * features — agents need to know BEFORE invoking variable/project commands
 * whether the instance supports them.
 */
async function checkLicenseFeatures(client: N8nClient): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const [endpoint, label, command] of [
    ['/variables', 'License: Variables API', 'n8nctl variable list'],
    ['/projects', 'License: Projects API', 'n8nctl project list'],
  ] as const) {
    try {
      await client.get(endpoint, { limit: 1 });
      out.push({ name: label, status: 'ok', detail: `available (${command})` });
    } catch (err) {
      const status = (err as { status?: number }).status;
      out.push({
        name: label,
        status: 'warn',
        detail:
          status === 403 || status === 404
            ? `license-gated on this instance (HTTP ${status})`
            : (err as Error).message,
        remediation:
          status === 403 || status === 404
            ? 'Upgrade the n8n plan to use this feature; the CLI command will fail with the same hint'
            : 'Transient error — re-run doctor',
      });
    }
  }
  return out;
}

export async function doctorHandler(
  factory: Factory,
  opts: DoctorOpts,
  _args: string[],
): Promise<void> {
  const results: CheckResult[] = [];
  const verbose: VerboseStats = {};

  results.push(checkNodeVersion());
  results.push(await checkConfigFile());
  results.push(await checkKeyring());
  results.push(checkEnvVars());

  let authOk = false;
  try {
    const auth = await factory.auth();
    authOk = true;
    results.push({
      name: 'Auth resolution',
      status: 'ok',
      detail: `profile "${auth.profileName}" via ${auth.source} → ${auth.host}`,
    });

    const client = await factory.client();
    results.push(await checkApiConnectivity(client));
    results.push(await checkReadPermission(client, '/tags', 'Tag permission'));
    results.push(await checkReadPermission(client, '/executions', 'Execution permission'));

    // Write + delete permission probe. Reuses a fixed-name probe tag so a key
    // lacking DELETE scope can't accumulate garbage tags on every run.
    const probe = await probeWritePermission(client);
    results.push(probe.write);
    if (probe.delete) results.push(probe.delete);

    results.push(...(await checkLicenseFeatures(client)));

    if (opts.verbose) {
      await collectVerboseStats(client, verbose);
    }
  } catch (err) {
    if (err instanceof AuthError) {
      results.push({ name: 'Auth resolution', status: 'fail', detail: err.message });
    } else {
      throw err;
    }
  }

  // --json: machine-readable results incl. per-check `remediation` so agents
  // can act on failures without parsing the human table.
  if (factory.flags.json) {
    const failed0 = results.filter((r) => r.status === 'fail').length;
    factory.io.stdout.write(
      JSON.stringify(
        { checks: results, verbose: opts.verbose ? verbose : undefined, ok: failed0 === 0 && authOk },
        null,
        2,
      ) + '\n',
    );
    if (failed0 > 0 || !authOk) process.exitCode = 1;
    return;
  }

  for (const r of results) {
    const icon = r.status === 'ok' ? c.green('✓') : r.status === 'warn' ? c.yellow('!') : c.red('✗');
    factory.io.stdout.write(`${icon} ${r.name.padEnd(42)} ${r.detail}\n`);
    if (r.remediation && r.status !== 'ok') {
      factory.io.stdout.write(`  ${c.dim(`fix: ${r.remediation}`)}\n`);
    }
  }

  if (opts.verbose) {
    factory.io.stdout.write(`\n${c.bold('Server stats')}\n`);
    if (verbose.serverVersion) {
      factory.io.stdout.write(`  ${'n8n version'.padEnd(40)} ${verbose.serverVersion}\n`);
    }
    if (verbose.latencyP50Ms !== undefined) {
      const samples = verbose.latencySamplesMs?.join(', ');
      factory.io.stdout.write(
        `  ${'GET /workflows latency p50'.padEnd(40)} ${verbose.latencyP50Ms}ms ${c.dim(`(samples: ${samples})`)}\n`,
      );
    }
    if (verbose.workflowsTotal !== undefined) {
      factory.io.stdout.write(
        `  ${'Workflows total / active'.padEnd(40)} ${verbose.workflowsTotal} / ${verbose.workflowsActive ?? '?'}\n`,
      );
    }
    if (verbose.executionsLast24hCount !== undefined) {
      const failureRate =
        verbose.executionsLast24hFailureRate !== undefined
          ? ` (${(verbose.executionsLast24hFailureRate * 100).toFixed(1)}% failed)`
          : '';
      factory.io.stdout.write(
        `  ${'Executions in last 50'.padEnd(40)} ${verbose.executionsLast24hCount}${failureRate}\n`,
      );
    }
    if (verbose.rateLimitRemaining) {
      factory.io.stdout.write(
        `  ${'Rate limit remaining'.padEnd(40)} ${verbose.rateLimitRemaining}${verbose.rateLimitReset ? ` (resets at ${verbose.rateLimitReset})` : ''}\n`,
      );
    }
  }

  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  factory.io.stdout.write(
    `\n${c.bold('Summary')}: ${results.length - failed - warned} ok, ${warned} warn, ${failed} fail\n`,
  );

  if (failed > 0 || !authOk) {
    process.exitCode = 1;
  }
}

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Run an end-to-end health check (env, config, keyring, API connectivity, permissions). Use --verbose for server version, latency, and workflow/execution stats.')
    .option('--verbose', 'Include server version, latency p50, workflow/execution stats, rate-limit headers')
    .action(withAction<DoctorOpts>(doctorHandler));
}

async function collectVerboseStats(
  client: N8nClient,
  out: VerboseStats,
): Promise<void> {
  // Server version + rate-limit headers. Goes through the shared client so
  // --insecure, timeout, auth, and the real User-Agent apply (pre-0.6.0 this
  // was a bare fetch() with a stale hardcoded UA that broke on self-signed
  // TLS instances).
  try {
    const headers = await client.probeHeaders('/workflows', { limit: 1 });
    if (headers['x-n8n-version']) out.serverVersion = headers['x-n8n-version'];
    if (headers['x-ratelimit-remaining']) out.rateLimitRemaining = headers['x-ratelimit-remaining'];
    if (headers['x-ratelimit-reset']) out.rateLimitReset = headers['x-ratelimit-reset'];
  } catch {
    // headers not available, non-fatal
  }

  // Latency p50 — 5 samples of GET /workflows?limit=1
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    try {
      await client.get('/workflows', { limit: 1 });
      samples.push(Date.now() - t0);
    } catch {
      // skip
    }
  }
  if (samples.length > 0) {
    const sorted = [...samples].sort((a, b) => a - b);
    out.latencySamplesMs = sorted;
    out.latencyP50Ms = sorted[Math.floor(sorted.length / 2)];
  }

  // Workflow stats — fetch all (paginated), count active/total
  try {
    let total = 0;
    let active = 0;
    for await (const w of client.paginate<{ active: boolean }>('/workflows', {})) {
      total++;
      if (w.active) active++;
    }
    out.workflowsTotal = total;
    out.workflowsActive = active;
  } catch {
    // skip
  }

  // Execution stats — last 50, count failures
  try {
    const resp = await client.get<{ data: Array<{ status?: string }> }>('/executions', {
      limit: 50,
    });
    out.executionsLast24hCount = resp.data.length;
    if (resp.data.length > 0) {
      const failed = resp.data.filter(
        (e) => e.status === 'error' || e.status === 'crashed',
      ).length;
      out.executionsLast24hFailureRate = failed / resp.data.length;
    }
  } catch {
    // skip
  }
}
