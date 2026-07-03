import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { readConfig, getConfigPath } from '../../lib/config.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import yaml from 'js-yaml';
import type { Factory } from '../../factory.js';

export async function configListHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const config = await readConfig();
  // Mask API keys stored in config (not recommended)
  const redacted = structuredClone(config);
  for (const [name, p] of Object.entries(redacted.profiles)) {
    if (p.apiKey) redacted.profiles[name] = { ...p, apiKey: '***redacted***' };
  }

  // Machine-readable (contract §2): --json/--jq/--template or non-TTY → JSON.
  const wantsMachine =
    Boolean(factory.flags.json) ||
    Boolean(factory.flags.jq) ||
    Boolean(factory.flags.template) ||
    !factory.io.isTTY;

  if (wantsMachine) {
    await printData(
      { path: getConfigPath(), ...redacted },
      { io: factory.io, opts: factory.flags },
    );
    return;
  }

  factory.io.stdout.write(`${c.dim(`# ${getConfigPath()}`)}\n`);
  factory.io.stdout.write(yaml.dump(redacted, { indent: 2 }));
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('Show all config values')
    .action(withAction(configListHandler));
}
