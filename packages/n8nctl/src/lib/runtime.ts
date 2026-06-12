import type { Command } from 'commander';
import { createFactory, type Factory, type GlobalFlags } from '../factory.js';
import { N8nCtlError, ExitCode } from './errors.js';
import { c } from './io.js';
import { validateOutputOptions } from './output.js';

export type ActionHandler<TOpts = Record<string, unknown>> = (
  factory: Factory,
  opts: TOpts,
  args: string[],
) => Promise<void> | void;

export function withAction<TOpts = Record<string, unknown>>(handler: ActionHandler<TOpts>) {
  return async function action(this: Command, ...rest: unknown[]) {
    const cmd = this;
    const argsPassed = rest.slice(0, rest.length - 2) as string[];
    const opts = rest[rest.length - 2] as TOpts;
    const globalOpts = cmd.optsWithGlobals() as GlobalFlags;
    const factory = createFactory(globalOpts);

    try {
      validateOutputOptions(globalOpts);
      await handler(factory, opts, argsPassed);
    } catch (err) {
      handleError(err, factory);
    }
  };
}

function handleError(err: unknown, factory: Factory): never {
  const { io } = factory;

  if (err instanceof N8nCtlError) {
    io.stderr.write(`${c.red('error')}: ${scrubAnsi(err.message)}\n`);
    if (err.hint) io.stderr.write(`${c.yellow('hint')}: ${scrubAnsi(err.hint)}\n`);
    process.exit(err.exitCode);
  }

  if (err instanceof Error) {
    io.stderr.write(`${c.red('error')}: ${scrubAnsi(err.message)}\n`);
    if (process.env.N8NCTL_DEBUG === '1' && err.stack) {
      io.stderr.write(`${c.dim(err.stack)}\n`);
    } else {
      io.stderr.write(`${c.dim('run with N8NCTL_DEBUG=1 for full stack trace')}\n`);
    }
    process.exit(ExitCode.InternalError);
  }

  io.stderr.write(`${c.red('error')}: unknown failure — ${scrubAnsi(String(err))}\n`);
  process.exit(ExitCode.InternalError);
}

/**
 * Strip ANSI escape sequences and other control characters from strings
 * that will be written to stderr.
 *
 * Note: the C0/C1 range alone already neutralises escape sequences (ESC=0x1B
 * sits inside \x0B-\x1F, so a sequence can never EXECUTE) — but stripping
 * only the introducer leaves the printable sequence body behind as residue
 * ("[2J", "]0;title"). The sequence-aware pass removes the whole sequence:
 * CSI (ESC[ / 0x9B), OSC (ESC] … BEL|ST), DCS/SOS/PM/APC (ESC P/X/^/_ … ST),
 * and 2-char ESC sequences.
 */
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCES =
  /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)?|[PX^_][\s\S]*?(?:\x1B\\|$)|[@-Z\\-_])|\x9B[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;
export function scrubAnsi(input: string): string {
  return input.replace(ANSI_SEQUENCES, '').replace(CONTROL_CHARS, '');
}
