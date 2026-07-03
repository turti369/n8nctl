import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import { readConfigSync } from '../../lib/config.js';
import { resolveSyncedCatalog, syncedCatalogPath } from '../../lib/validator-catalog.js';
import type { Factory } from '../../factory.js';

function activeProfileName(factory: Factory): string {
  return factory.flags.profile ?? readConfigSync().activeProfile ?? 'default';
}

export async function catalogShowHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const profile = activeProfileName(factory);
  const catalog = resolveSyncedCatalog(profile);

  if (!catalog) {
    const wantsJson = Boolean(factory.flags.json) || !factory.io.isTTY;
    if (wantsJson) {
      await printData(
        { profile, synced: false, path: syncedCatalogPath(profile) },
        { io: factory.io, opts: factory.flags },
      );
      return;
    }
    factory.io.stdout.write(
      `${c.dim('no synced catalog for profile')} "${profile}" — run \`n8nctl catalog sync\`\n`,
    );
    return;
  }

  const summary = {
    profile,
    synced: true,
    path: syncedCatalogPath(profile),
    nodeCount: Object.keys(catalog.nodes).length,
    meta: catalog._meta ?? null,
  };
  await printData(summary, { io: factory.io, opts: factory.flags });
}

export function createCatalogShowCommand(): Command {
  return new Command('show')
    .description('Show the synced validator catalog for the active profile (metadata + node count)')
    .action(withAction(catalogShowHandler));
}
