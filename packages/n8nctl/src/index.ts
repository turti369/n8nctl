#!/usr/bin/env node
import { Command, Option } from 'commander';
import { createRequire } from 'node:module';
import { createWorkflowCommand } from './commands/workflow/index.js';
import { createExecutionCommand } from './commands/execution/index.js';
import { createCredentialCommand } from './commands/credential/index.js';
import { createAuthCommand } from './commands/auth/index.js';
import { createConfigCommand } from './commands/config/index.js';
import { createProfileCommand } from './commands/profile/index.js';
import { createTagNoun } from './commands/tag/index.js';
import { createDoctorCommand } from './commands/doctor.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('n8nctl')
  .description('CLI for managing n8n workflows via REST API')
  .version(pkg.version, '-v, --version')
  .addOption(new Option('--api-key <token>', 'API key (overrides env and config)').env('N8N_API_KEY'))
  .addOption(new Option('--host <url>', 'n8n host URL (overrides env and config)').env('N8N_HOST'))
  .option('--profile <name>', 'Use a specific profile')
  .option('--json', 'Output JSON regardless of TTY')
  .option('--jq <expr>', 'Filter output via jq expression')
  .option('--template <tmpl>', 'Format output via Handlebars template')
  .option('--timeout <ms>', 'HTTP request timeout in ms (default: 30000)', (v) => Number(v))
  .option('--insecure', 'Disable TLS certificate verification (self-signed dev instances only)')
  .option('--dry-run', 'Preview what would change without making destructive API calls')
  .showHelpAfterError();

program.addCommand(createWorkflowCommand());
program.addCommand(createExecutionCommand());
program.addCommand(createCredentialCommand());
program.addCommand(createTagNoun());
program.addCommand(createAuthCommand());
program.addCommand(createConfigCommand());
program.addCommand(createProfileCommand());
program.addCommand(createDoctorCommand());

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(5);
});
