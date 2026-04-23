import { Command } from 'commander';
import { createListCommand } from './list.js';
import { createAddCommand } from './add.js';
import { createSwitchCommand } from './switch.js';
import { createRemoveCommand } from './remove.js';

export function createProfileCommand(): Command {
  const cmd = new Command('profile').description('Manage multi-instance profiles');
  cmd.addCommand(createListCommand());
  cmd.addCommand(createAddCommand());
  cmd.addCommand(createSwitchCommand());
  cmd.addCommand(createRemoveCommand());
  return cmd;
}
