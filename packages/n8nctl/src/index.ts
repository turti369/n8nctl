#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { ExitCode } from './lib/errors.js';
import { buildProgram } from './program.js';

const program = buildProgram();

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
