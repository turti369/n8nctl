import { Command } from 'commander';
import { createListCommand } from './list.js';

export function createCredentialCommand(): Command {
  const cmd = new Command('credential')
    .alias('cred')
    .description('Inspect credentials (read-only — values never exposed via API)');
  cmd.addCommand(createListCommand());
  return cmd;
}
