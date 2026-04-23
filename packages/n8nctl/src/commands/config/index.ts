import { Command } from 'commander';
import { createGetCommand } from './get.js';
import { createSetCommand } from './set.js';
import { createListCommand } from './list.js';

export function createConfigCommand(): Command {
  const cmd = new Command('config').description('Manage n8nctl configuration');
  cmd.addCommand(createGetCommand());
  cmd.addCommand(createSetCommand());
  cmd.addCommand(createListCommand());
  return cmd;
}
