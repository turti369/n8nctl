import type { Command } from 'commander';
import { createFactory, type Factory, type GlobalFlags } from '../factory.js';
import { N8nCtlError, ExitCode } from './errors.js';
import { c } from './io.js';
import { validateOutputOptions } from './output.js';
import { scrubAnsi } from './util.js';

export { scrubAnsi };

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

    // A named profile is self-contained: when --profile is chosen explicitly,
    // an AMBIENT env N8N_HOST / N8N_API_KEY must NOT override the profile's own
    // host/key (otherwise "profile key + env host" → 401). An explicit --host /
    // --api-key on the CLI still wins. Commander exposes the value source per
    // option ('cli' | 'env' | 'default'); the global options live on the root.
    const root = rootCommand(cmd);
    applyProfileHostPrecedence(globalOpts, {
      profile: root.getOptionValueSource('profile') as OptionSource,
      host: root.getOptionValueSource('host') as OptionSource,
      apiKey: root.getOptionValueSource('apiKey') as OptionSource,
    });

    const factory = createFactory(globalOpts);

    try {
      validateOutputOptions(globalOpts);
      await handler(factory, opts, argsPassed);
    } catch (err) {
      handleError(err, factory);
    }
  };
}

function rootCommand(cmd: Command): Command {
  let c = cmd;
  while (c.parent) c = c.parent;
  return c;
}

export type OptionSource = 'cli' | 'env' | 'default' | 'config' | 'implied' | undefined;

/**
 * When --profile is set on the CLI, drop env-sourced host/apiKey so the named
 * profile's own host/key are used (an explicit --host/--api-key still wins).
 * Pure + exported for regression testing the live-found "profile key + ambient
 * N8N_HOST → 401" bug. Mutates `flags` in place.
 */
export function applyProfileHostPrecedence(
  flags: GlobalFlags,
  sources: { profile: OptionSource; host: OptionSource; apiKey: OptionSource },
): void {
  if (sources.profile !== 'cli') return;
  if (sources.host === 'env') delete flags.host;
  if (sources.apiKey === 'env') delete flags.apiKey;
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
