import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig, updateConfig } from '../../lib/config.js';
import {
  isKeyringAvailable,
  setPassword,
  keyringAccountFor,
  keyringCookieAccountFor,
  keyringPasswordAccountFor,
} from '../../lib/keyring.js';
import { N8nClient } from '../../lib/api.js';
import { N8nSessionClient } from '../../lib/session-api.js';
import { c } from '../../lib/io.js';
import { AuthError } from '../../lib/errors.js';
import type { Factory } from '../../factory.js';

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
  session?: boolean;
  email?: string;
  cookieOnly?: boolean;
}

export async function loginHandler(
  factory: Factory,
  opts: LoginOpts,
  _args: string[],
): Promise<void> {
  if (opts.session) {
    // Session auth attaches to the ACTIVE profile by default (so it
    // merges with an existing api-key profile), not a literal "default".
    const cfg = await readConfig();
    const sessionProfile =
      opts.profile ?? factory.flags.profile ?? cfg.activeProfile ?? 'default';
    await sessionLogin(factory, opts, sessionProfile);
    return;
  }
  const profileName = opts.profile ?? factory.flags.profile ?? 'default';

  // The subcommand declares its own --host/--api-key/--profile in
  // addition to the program-level globals (Commander does not merge
  // values across the two scopes). Fall back to the global flags so
  // env vars (N8N_HOST / N8N_API_KEY) and `n8nctl --host X auth login`
  // both bypass the interactive prompts.

  const answers = await promptMissing({
    host: opts.host ?? factory.flags.host,
    apiKey: opts.apiKey ?? factory.flags.apiKey,
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
}

export function createLoginCommand(): Command {
  return new Command('login')
    .description('Configure credentials interactively (stored in OS keyring by default)')
    .option('--host <url>', 'n8n host URL (non-interactive)')
    .option('--profile <name>', 'Profile name (default: "default")')
    .option('--api-key <token>', 'API key (non-interactive)')
    .option('--no-keyring', 'Store key in config file instead of OS keyring')
    .option('--insecure', 'Store profile with TLS verification disabled (self-signed dev instances)')
    .option('--session', 'Configure internal /rest session auth (email + password) for `workflow run`')
    .option('--email <addr>', 'n8n login email (session mode, non-interactive)')
    .option('--cookie-only', 'Session mode: do NOT store password; re-auth on cookie expiry (higher security)')
    .action(withAction<LoginOpts>(loginHandler));
}

/**
 * Configure /rest session auth (email + password) for `workflow run`. Verifies
 * by logging in + whoami, caches the cookie in keyring, and (unless
 * --cookie-only) stores the password in keyring. Merges into an existing
 * profile so an API key on the same profile is preserved.
 */
async function sessionLogin(factory: Factory, opts: LoginOpts, profileName: string): Promise<void> {
  const cookieOnly = opts.cookieOnly === true;
  const prompts: Array<Record<string, unknown>> = [];
  // Allow non-interactive setup from env (N8N_HOST/N8N_EMAIL/N8N_PASSWORD) so
  // the login can be scripted; prompt only for whatever is missing.
  const host0 = opts.host ?? factory.flags.host ?? process.env.N8N_HOST;
  const email0 = opts.email ?? process.env.N8N_EMAIL;
  const password0 = process.env.N8N_PASSWORD;
  if (!host0) {
    prompts.push({
      type: 'input',
      name: 'host',
      message: 'n8n host URL (e.g. https://n8n.example.com):',
      validate: (v: string) => /^https?:\/\//.test(v) || 'Must start with http:// or https://',
    });
  }
  if (!email0) {
    prompts.push({ type: 'input', name: 'email', message: 'n8n login email:' });
  }
  if (!password0) {
    prompts.push({
      type: 'password',
      name: 'password',
      message: 'n8n login password:',
      mask: '*',
      validate: (v: string) => v.length > 0 || 'Password required',
    });
  }
  // Lazy-load inquirer only when we actually need to prompt — keeps it off the
  // startup path (the whole command tree is constructed on every invocation).
  const answers = prompts.length > 0
    ? ((await (await import('inquirer')).default.prompt(prompts as never)) as Record<string, string>)
    : ({} as Record<string, string>);
  const host = stripSlash(host0 ?? answers.host);
  const email = email0 ?? answers.email;
  const password = password0 ?? answers.password;

  factory.io.stderr.write(`${c.dim('→')} verifying session login against ${host}...\n`);
  const client = new N8nSessionClient(
    { host, email, password, profileName },
    {
      insecure: opts.insecure,
      onCookie: async (cookie) => {
        if (await isKeyringAvailable()) await setPassword(keyringCookieAccountFor(profileName), cookie);
      },
    },
  );
  await client.login(); // throws AuthError on bad creds; persists cookie via onCookie
  const who = await client.whoami();

  let passwordStored = false;
  if (!cookieOnly && (await isKeyringAvailable())) {
    passwordStored = await setPassword(keyringPasswordAccountFor(profileName), password);
  }

  await updateConfig((cfg) => {
    const existing = cfg.profiles[profileName] ?? { host };
    const methods = new Set(existing.authMethods ?? []);
    if (existing.apiKey || existing.keyStoredInKeyring) methods.add('api-key');
    methods.add('session');
    cfg.profiles[profileName] = {
      ...existing,
      host,
      authMethods: [...methods],
      session: { email, passwordInKeyring: passwordStored, cookieOnly },
      ...(opts.insecure ? { insecure: true } : {}),
    };
    if (!cfg.activeProfile) cfg.activeProfile = profileName;
    return cfg;
  });

  factory.io.stdout.write(
    `${c.green('✓')} session configured for profile "${profileName}" ` +
      `(${who.email ?? email}${who.role ? `, ${who.role}` : ''})\n`,
  );
  factory.io.stdout.write(`${c.dim('→')} host: ${host}\n`);
  if (cookieOnly) {
    factory.io.stderr.write(
      `${c.dim('note')}: cookie-only — password not stored. You'll re-auth when the cookie expires (~7d).\n`,
    );
  } else if (!passwordStored) {
    factory.io.stderr.write(
      `${c.yellow('warning')}: keyring unavailable — password NOT stored; only the cookie is cached ` +
        `(re-run \`auth login --session\` after it expires).\n`,
    );
  }
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
    ? ((await (await import('inquirer')).default.prompt(questions as never)) as Record<string, string>)
    : ({} as Record<string, string>);
  return {
    host: partial.host ?? answers.host,
    apiKey: partial.apiKey ?? answers.apiKey,
  };
}

function stripSlash(s: string): string {
  return s.replace(/\/+$/, '');
}
