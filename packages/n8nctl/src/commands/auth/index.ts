import { Command } from 'commander';
import { createLoginCommand } from './login.js';
import { createStatusCommand } from './status.js';
import { createLogoutCommand } from './logout.js';

export function createAuthCommand(): Command {
  const cmd = new Command('auth').description('Manage authentication and profiles');
  cmd.addCommand(createLoginCommand());
  cmd.addCommand(createStatusCommand());
  cmd.addCommand(createLogoutCommand());
  return cmd;
}
