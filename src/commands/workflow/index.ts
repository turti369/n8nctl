import { Command } from 'commander';
import { createListCommand } from './list.js';
import { createGetCommand } from './get.js';
import { createCreateCommand } from './create.js';
import { createUpdateCommand } from './update.js';
import { createActivateCommand } from './activate.js';
import { createDeactivateCommand } from './deactivate.js';
import { createExecuteCommand } from './execute.js';
import { createBackupCommand } from './backup.js';
import { createDeleteCommand } from './delete.js';
import { createValidateCommand } from './validate.js';

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow')
    .alias('wf')
    .description('Manage n8n workflows');
  cmd.addCommand(createListCommand());
  cmd.addCommand(createGetCommand());
  cmd.addCommand(createCreateCommand());
  cmd.addCommand(createUpdateCommand());
  cmd.addCommand(createActivateCommand());
  cmd.addCommand(createDeactivateCommand());
  cmd.addCommand(createExecuteCommand());
  cmd.addCommand(createBackupCommand());
  cmd.addCommand(createDeleteCommand());
  cmd.addCommand(createValidateCommand());
  return cmd;
}
