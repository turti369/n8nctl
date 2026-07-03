#!/usr/bin/env node
import { Command, Option, InvalidArgumentError, CommanderError } from 'commander';
import { createRequire } from 'node:module';
import { ExitCode } from './lib/errors.js';
import { createWorkflowCommand } from './commands/workflow/index.js';
import { createExecutionCommand } from './commands/execution/index.js';
import { createCredentialCommand } from './commands/credential/index.js';
import { createAuthCommand } from './commands/auth/index.js';
import { createConfigCommand } from './commands/config/index.js';
import { createProfileCommand } from './commands/profile/index.js';
import { createTagNoun } from './commands/tag/index.js';
import { createDoctorCommand } from './commands/doctor.js';
import { createCompletionCommand } from './commands/completion.js';
import { createVariableCommand } from './commands/variable/index.js';
import { createAuditCommand } from './commands/audit.js';
import { createUserCommand } from './commands/user/index.js';
import { createProjectCommand } from './commands/project/index.js';
import { createSourceControlCommand } from './commands/source-control/index.js';

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
  .option('--timeout <ms>', 'HTTP request timeout in ms (default: 30000)', (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) {
      // commander prints "error: option '--timeout <ms>' argument 'X' is invalid. <message>"
      throw new InvalidArgumentError('must be a positive integer (milliseconds)');
    }
    return n;
  })
  .option('--insecure', 'Disable TLS certificate verification (self-signed dev instances only)')
  .option('--dry-run', 'Preview what would change without making destructive API calls')
  .addOption(
    new Option('--log-format <fmt>', 'stderr log format (text or ndjson). NDJSON emits one JSON object per event for agent consumption.')
      .choices(['text', 'ndjson'])
      .env('N8NCTL_LOG_FORMAT'),
  )
  .showHelpAfterError();

program.addCommand(createWorkflowCommand());
program.addCommand(createExecutionCommand());
program.addCommand(createCredentialCommand());
program.addCommand(createTagNoun());
program.addCommand(createAuthCommand());
program.addCommand(createConfigCommand());
program.addCommand(createProfileCommand());
program.addCommand(createVariableCommand());
program.addCommand(createUserCommand());
program.addCommand(createProjectCommand());
program.addCommand(createSourceControlCommand());
program.addCommand(createAuditCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createCompletionCommand());

// Route Commander's own parse errors through the frozen exit-code contract.
// Without exitOverride, Commander calls process.exit(1) itself on a bad/unknown
// option — colliding with ExitCode.ApiError=1. With it, Commander throws a
// CommanderError (after already printing its message/help) which the catch
// below maps: help/version display → 0, any parse error → ValidationError (3).
// exitOverride is not inherited by addCommand()'d subcommands, so apply it to
// the whole tree (a bad SUBCOMMAND option must also exit 3, not 1 or 5).
function applyExitOverride(cmd: Command): void {
  cmd.exitOverride();
  for (const sub of cmd.commands) applyExitOverride(sub);
}
applyExitOverride(program);

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CommanderError) {
    // Commander sets exitCode 0 for informational displays (--help, --version)
    // and non-zero for actual parse errors. It has already written output.
    process.exit(err.exitCode === 0 ? ExitCode.Success : ExitCode.ValidationError);
  }
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(ExitCode.InternalError);
});
