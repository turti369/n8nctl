import { Command } from 'commander';
import { createListCommand } from './list.js';
import { createSetCommand } from './set.js';
import { createDeleteCommand } from './delete.js';

export function createVariableCommand(): Command {
  const cmd = new Command('variable')
    .alias('var')
    .description('Manage instance variables (licensed n8n feature)');
  cmd.addCommand(createListCommand());
  cmd.addCommand(createSetCommand());
  cmd.addCommand(createDeleteCommand());
  return cmd;
}
