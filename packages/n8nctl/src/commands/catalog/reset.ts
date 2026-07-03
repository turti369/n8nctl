import { Command } from 'commander';
import { promises as fs, existsSync } from 'node:fs';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import { readConfigSync } from '../../lib/config.js';
import { syncedCatalogPath } from '../../lib/validator-catalog.js';
import type { Factory } from '../../factory.js';

function activeProfileName(factory: Factory): string {
  return factory.flags.profile ?? readConfigSync().activeProfile ?? 'default';
}

export async function catalogResetHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const profile = activeProfileName(factory);
  const file = syncedCatalogPath(profile);

  if (!existsSync(file)) {
    factory.io.stdout.write(
      `${c.dim('nothing to reset')} — no synced catalog for profile "${profile}" (validation already uses the bundled catalog)\n`,
    );
    return;
  }

  if (factory.flags.dryRun) {
    factory.io.stdout.write(`${c.yellow('[dry-run]')} would remove ${file}\n`);
    return;
  }

  await fs.rm(file, { force: true });
  factory.io.event(
    'catalog-reset',
    { profile, path: file },
    `${c.green('✓')} removed synced catalog for "${profile}" — validation falls back to the bundled catalog`,
  );
}

export function createCatalogResetCommand(): Command {
  return new Command('reset')
    .description('Remove the synced catalog for the active profile (validation reverts to the bundled catalog)')
    .action(withAction(catalogResetHandler));
}
