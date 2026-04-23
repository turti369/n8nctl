import { Command } from 'commander';
import inquirer from 'inquirer';
import { withAction } from '../../lib/runtime.js';
import { updateConfig } from '../../lib/config.js';
import { isKeyringAvailable, setPassword, keyringAccountFor } from '../../lib/keyring.js';
import { N8nClient } from '../../lib/api.js';
import { c } from '../../lib/io.js';
import { AuthError } from '../../lib/errors.js';

interface LoginOpts {
  host?: string;
  profile?: string;
  apiKey?: string;
  /**
   * Commander maps `--no-keyring` → `{ keyring: false }` (not `noKeyring`).
   * Default when flag absent: `true`.
   */
  keyring?: boolean;
  insecure?: boolean;
}

export function createLoginCommand(): Command {
  return new Command('login')
    .description('Configure credentials interactively (stored in OS keyring by default)')
    .option('--host <url>', 'n8n host URL (non-interactive)')
    .option('--profile <name>', 'Profile name (default: "default")')
    .option('--api-key <token>', 'API key (non-interactive)')
    .option('--no-keyring', 'Store key in config file instead of OS keyring')
    .option('--insecure', 'Store profile with TLS verification disabled (self-signed dev instances)')
    .action(
      withAction<LoginOpts>(async (factory, opts) => {
        const profileName = opts.profile ?? 'default';

        const answers = await promptMissing({
          host: opts.host,
          apiKey: opts.apiKey,
        });

        const host = stripSlash(answers.host);
        const apiKey = answers.apiKey;

        // Verify credentials by hitting /workflows?limit=1
        factory.io.stderr.write(`${c.dim('→')} verifying credentials against ${host}...\n`);
        const client = new N8nClient(
          { host, apiKey, profileName, source: 'flag' },
          { insecure: opts.insecure },
        );
        try {
          await client.get('/workflows', { limit: 1 });
        } catch (err) {
          throw new AuthError(
            `Verification failed: ${(err as Error).message}`,
            'Check the host URL and API key, then re-run `n8nctl auth login`.',
          );
        }

        const keyringEnabled = opts.keyring !== false; // defaults true; --no-keyring sets it false
        const useKeyring = keyringEnabled && (await isKeyringAvailable());

        let stored: 'keyring' | 'file' = 'file';
        if (useKeyring) {
          const ok = await setPassword(keyringAccountFor(profileName), apiKey);
          if (ok) stored = 'keyring';
        }

        await updateConfig((cfg) => {
          cfg.profiles[profileName] = {
            host,
            keyStoredInKeyring: stored === 'keyring',
            ...(stored === 'file' ? { apiKey } : {}),
            ...(opts.insecure ? { insecure: true } : {}),
          };
          if (!cfg.activeProfile) cfg.activeProfile = profileName;
          return cfg;
        });

        factory.io.stdout.write(`${c.green('✓')} credentials stored for profile "${profileName}" (${stored})\n`);
        factory.io.stdout.write(`${c.dim('→')} host: ${host}\n`);
        if (stored === 'file') {
          factory.io.stderr.write(
            `${c.yellow('warning')}: key stored in plaintext at config file. ` +
              `Install keytar support for OS keyring storage.\n`,
          );
        }
      }),
    );
}

async function promptMissing(partial: { host?: string; apiKey?: string }): Promise<{ host: string; apiKey: string }> {
  const questions: Array<Record<string, unknown>> = [];
  if (!partial.host) {
    questions.push({
      type: 'input',
      name: 'host',
      message: 'n8n host URL (e.g. https://n8n.example.com):',
      validate: (v: string) => /^https?:\/\//.test(v) || 'Must start with http:// or https://',
    });
  }
  if (!partial.apiKey) {
    questions.push({
      type: 'password',
      name: 'apiKey',
      message: 'API key:',
      mask: '*',
      validate: (v: string) => v.length > 10 || 'API key looks too short',
    });
  }
  const answers = questions.length > 0
    ? ((await inquirer.prompt(questions as never)) as Record<string, string>)
    : ({} as Record<string, string>);
  return {
    host: partial.host ?? answers.host,
    apiKey: partial.apiKey ?? answers.apiKey,
  };
}

function stripSlash(s: string): string {
  return s.replace(/\/+$/, '');
}
