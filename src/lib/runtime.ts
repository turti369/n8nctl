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
    io.stderr.write(`${c.red('error')}: ${err.message}\n`);
    if (err.hint) io.stderr.write(`${c.yellow('hint')}: ${err.hint}\n`);
    process.exit(err.exitCode);
  }

  if (err instanceof Error) {
    io.stderr.write(`${c.red('error')}: ${err.message}\n`);
    if (process.env.N8NCTL_DEBUG === '1' && err.stack) {
      io.stderr.write(`${c.dim(err.stack)}\n`);
    } else {
      io.stderr.write(`${c.dim('run with N8NCTL_DEBUG=1 for full stack trace')}\n`);
    }
    process.exit(ExitCode.InternalError);
  }

  io.stderr.write(`${c.red('error')}: unknown failure — ${String(err)}\n`);
  process.exit(ExitCode.InternalError);
}
