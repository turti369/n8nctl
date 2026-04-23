import { Command } from 'commander';
import { createListCommand } from './list.js';
import { createGetCommand } from './get.js';
import { createRetryCommand } from './retry.js';

export function createExecutionCommand(): Command {
  const cmd = new Command('execution')
    .alias('exec')
    .description('Inspect and manage workflow executions');
  cmd.addCommand(createListCommand());
  cmd.addCommand(createGetCommand());
  cmd.addCommand(createRetryCommand());
  return cmd;
}
