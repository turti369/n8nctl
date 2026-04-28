import { Command } from 'commander';
import { withAction } from '../lib/runtime.js';
import { resolveAuth } from '../lib/auth.js';
import { readConfig } from '../lib/config.js';
import { isKeyringAvailable } from '../lib/keyring.js';
import { N8nClient } from '../lib/api.js';
import { c } from '../lib/io.js';
import { AuthError } from '../lib/errors.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
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

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Run an end-to-end health check (env, config, keyring, API connectivity, permissions). Use --verbose for server version, latency, and workflow/execution stats.')
    .option('--verbose', 'Include server version, latency p50, workflow/execution stats, rate-limit headers')
    .action(
      withAction<DoctorOpts>(async (factory, opts) => {
        const results: CheckResult[] = [];
        const verbose: VerboseStats = {};

        // Node version
        const nodeVersion = process.versions.node;
        const major = Number(nodeVersion.split('.')[0]);
        results.push({
          name: 'Node.js version',
          status: major >= 20 ? 'ok' : 'fail',
          detail: `${nodeVersion} (required: >=20)`,
        });

        // Config file
        try {
          const cfg = await readConfig();
          const profileCount = Object.keys(cfg.profiles).length;
          results.push({
            name: 'Config file',
            status: 'ok',
            detail: `${profileCount} profile(s), active: ${cfg.activeProfile ?? 'none'}`,
          });
        } catch (err) {
          results.push({
            name: 'Config file',
            status: 'fail',
            detail: (err as Error).message,
          });
        }

        // Keyring
        const keyring = await isKeyringAvailable();
        results.push({
          name: 'OS keyring (keytar)',
          status: keyring ? 'ok' : 'warn',
          detail: keyring ? 'available' : 'unavailable — credentials fall back to plaintext config',
        });

        // Env vars
        const envSet = Boolean(process.env.N8N_API_KEY && process.env.N8N_HOST);
        results.push({
          name: 'Env vars (N8N_API_KEY + N8N_HOST)',
          status: envSet ? 'ok' : 'warn',
          detail: envSet ? 'set' : 'not set — using profile-based auth',
        });

        // Auth resolution
        let authOk = false;
        try {
          const auth = await resolveAuth({
            apiKey: factory.flags.apiKey,
            host: factory.flags.host,
            profile: factory.flags.profile,
          });
          authOk = true;
          results.push({
            name: 'Auth resolution',
            status: 'ok',
            detail: `profile "${auth.profileName}" via ${auth.source} → ${auth.host}`,
          });

          // API reachability
          const client = new N8nClient(auth, {
            timeout: factory.flags.timeout,
            insecure: factory.flags.insecure ?? auth.insecure,
          });
          try {
            await client.get('/workflows', { limit: 1 });
            results.push({
              name: 'API connectivity (GET /workflows)',
              status: 'ok',
              detail: 'reachable + authenticated',
            });
          } catch (err) {
            results.push({
              name: 'API connectivity',
              status: 'fail',
              detail: (err as Error).message,
            });
          }

          // Tags permission
          try {
            await client.get('/tags', { limit: 1 });
            results.push({
              name: 'Tag permission (GET /tags)',
              status: 'ok',
              detail: 'available',
            });
          } catch (err) {
            results.push({
              name: 'Tag permission',
              status: 'warn',
              detail: (err as Error).message,
            });
          }

          // Executions permission
          try {
            await client.get('/executions', { limit: 1 });
            results.push({
              name: 'Execution permission (GET /executions)',
              status: 'ok',
              detail: 'available',
            });
          } catch (err) {
            results.push({
              name: 'Execution permission',
              status: 'warn',
              detail: (err as Error).message,
            });
          }

          // Write permission probe — create + delete a tag to distinguish
          // read-only API keys from read-write ones. If POST fails, user will
          // hit 403 mid-pipeline; detecting it here saves a broken deploy.
          //
          // n8n enforces a 24-character max on tag names (and misleadingly
          // returns 409 "Tag already exists" on overrun). Keep the probe name
          // well under the limit: "n8nctl-" (7) + 12 random chars = 19 chars.
          const probeSuffix =
            Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 8);
          const probeName = `n8nctl-${probeSuffix}`;
          let createdTagId: string | null = null;
          try {
            const created = await client.post<{ id: string; name: string }>('/tags', { name: probeName });
            createdTagId = created.id;
            results.push({
              name: 'Write permission (POST /tags)',
              status: 'ok',
              detail: 'read-write API key',
            });
          } catch (err) {
            const msg = (err as Error).message;
            const looks403 = /403|forbidden/i.test(msg);
            results.push({
              name: 'Write permission',
              status: looks403 ? 'fail' : 'warn',
              detail: looks403
                ? 'API key is READ-ONLY — destructive commands will fail mid-pipeline'
                : msg,
            });
          }

          // Verbose mode — gather server version, latency, throughput
          if (opts.verbose) {
            await collectVerboseStats(client, auth.host, verbose);
          }

          // Clean up probe tag
          if (createdTagId) {
            try {
              await client.delete(`/tags/${encodeURIComponent(createdTagId)}`);
              results.push({
                name: 'Delete permission (DELETE /tags/:id)',
                status: 'ok',
                detail: 'full read-write-delete',
              });
            } catch (err) {
              const msg = (err as Error).message;
              const looks403 = /403|forbidden/i.test(msg);
              results.push({
                name: 'Delete permission',
                status: 'warn',
                detail: looks403
                  ? `API key can CREATE but not DELETE tags — probe tag "${probeName}" left on instance`
                  : `probe cleanup failed: ${msg}; delete "${probeName}" manually`,
              });
            }
          }
        } catch (err) {
          if (err instanceof AuthError) {
            results.push({
              name: 'Auth resolution',
              status: 'fail',
              detail: err.message,
            });
          } else {
            throw err;
          }
        }

        for (const r of results) {
          const icon = r.status === 'ok' ? c.green('✓') : r.status === 'warn' ? c.yellow('!') : c.red('✗');
          factory.io.stdout.write(`${icon} ${r.name.padEnd(42)} ${r.detail}\n`);
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
      }),
    );
}

async function collectVerboseStats(
  client: N8nClient,
  host: string,
  out: VerboseStats,
): Promise<void> {
  // Server version — n8n exposes /api/v1/openapi.yml with version info, but
  // simpler: HEAD on root and read X-N8N-Version header if present, otherwise
  // skip silently.
  try {
    const resp = await fetch(`${host}/api/v1/workflows?limit=1`, {
      headers: { 'User-Agent': 'n8nctl/0.3.0' },
    });
    const version = resp.headers.get('x-n8n-version');
    if (version) out.serverVersion = version;
    const remaining = resp.headers.get('x-ratelimit-remaining');
    if (remaining) out.rateLimitRemaining = remaining;
    const reset = resp.headers.get('x-ratelimit-reset');
    if (reset) out.rateLimitReset = reset;
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
