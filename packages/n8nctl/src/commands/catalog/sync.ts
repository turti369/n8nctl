import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { loadNodeCatalog } from '../../lib/node-catalog.js';
import {
  transformToCatalog,
  bundledNodeCount,
  writeSyncedCatalog,
} from '../../lib/validator-catalog.js';
import type { Factory } from '../../factory.js';

interface CatalogSyncOpts {
  refresh?: boolean;
}

export async function catalogSyncHandler(
  factory: Factory,
  opts: CatalogSyncOpts,
  _args: string[],
): Promise<void> {
  // Uses the session client — /types/nodes.json is behind editor auth.
  const session = await factory.sessionClient();
  const sess = await factory.session();

  const nodes = await loadNodeCatalog(session, { refresh: opts.refresh });
  const catalog = transformToCatalog(nodes, session.host);
  const count = Object.keys(catalog.nodes).length;

  // Sanity gate: never overwrite the bundled catalog with a DEGRADED one (a
  // partial/failed fetch). A real instance has far more node types than the
  // 36-node bundled snapshot.
  const floor = bundledNodeCount();
  if (count < floor) {
    throw new ValidationError(
      `Synced catalog has only ${count} node types (< bundled ${floor}) — refusing to write a degraded catalog.`,
      'Re-run with --refresh, or verify the instance /types/nodes.json is complete.',
    );
  }

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would sync ${count} node types for profile "${sess.profileName}"\n`,
    );
    return;
  }

  const dest = await writeSyncedCatalog(sess.profileName, catalog);
  factory.io.event(
    'catalog-synced',
    { profile: sess.profileName, host: session.host, nodeCount: count, path: dest },
    `${c.green('✓')} synced ${c.bold(String(count))} node types from ${session.host} → ${dest}`,
  );
  factory.io.stdout.write(
    `${c.green('✓')} catalog synced (${count} node types) — \`workflow validate\` now checks against this instance's nodes\n`,
  );
}

export function createCatalogSyncCommand(): Command {
  return new Command('sync')
    .description(
      "Generate an offline validator catalog from THIS instance's live node types " +
        '(/types/nodes.json, incl. community nodes), so `workflow validate` param-checks ' +
        'against the real node set instead of the 36-node bundled snapshot. Requires ' +
        '`n8nctl auth login --session`. Stored per profile.',
    )
    .option('--refresh', 'Force refetch the live node catalog (bypass the 24h cache)')
    .action(withAction<CatalogSyncOpts>(catalogSyncHandler));
}
