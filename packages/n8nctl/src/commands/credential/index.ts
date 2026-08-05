import { Command } from 'commander';
import { createListCommand } from './list.js';
import { createSchemaCommand } from './schema.js';
import { createCreateCommand } from './create.js';
import { createDeleteCommand } from './delete.js';
import { createTransferCommand } from './transfer.js';

export function createCredentialCommand(): Command {
  const cmd = new Command('credential')
    .alias('cred')
    .description('Manage credentials (list/inspect read-only; create from JSON file)');
  cmd.addCommand(createListCommand());
  cmd.addCommand(createSchemaCommand());
  cmd.addCommand(createCreateCommand());
  cmd.addCommand(createDeleteCommand());
  cmd.addCommand(createTransferCommand());
  return cmd;
}
