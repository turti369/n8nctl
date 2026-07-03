import { Command } from 'commander';
import { createCatalogSyncCommand } from './sync.js';
import { createCatalogShowCommand } from './show.js';
import { createCatalogResetCommand } from './reset.js';

export function createCatalogCommand(): Command {
  const cmd = new Command('catalog').description(
    "Manage the offline validator catalog synced from an instance's live node types",
  );
  cmd.addCommand(createCatalogSyncCommand());
  cmd.addCommand(createCatalogShowCommand());
  cmd.addCommand(createCatalogResetCommand());
  return cmd;
}
