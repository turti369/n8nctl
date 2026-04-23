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

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Run an end-to-end health check (env, config, keyring, API connectivity, permissions)')
    .action(
      withAction(async (factory) => {
        const results: CheckResult[] = [];

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
