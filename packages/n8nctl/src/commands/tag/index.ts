import { Command } from 'commander';
import { createListCommand } from './list.js';
import { createCreateCommand } from './create.js';
import { createUpdateCommand } from './update.js';
import { createDeleteCommand } from './delete.js';

export function createTagNoun(): Command {
  const cmd = new Command('tag').description('Manage tags on the active instance');
  cmd.addCommand(createListCommand());
  cmd.addCommand(createCreateCommand());
  cmd.addCommand(createUpdateCommand());
  cmd.addCommand(createDeleteCommand());
  return cmd;
}
