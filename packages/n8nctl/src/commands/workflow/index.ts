import { Command } from 'commander';
import { createListCommand } from './list.js';
import { createGetCommand } from './get.js';
import { createCreateCommand } from './create.js';
import { createUpdateCommand } from './update.js';
import { createActivateCommand } from './activate.js';
import { createDeactivateCommand } from './deactivate.js';
import { createTriggerWebhookCommand } from './trigger-webhook.js';
import { createBackupCommand } from './backup.js';
import { createDeleteCommand } from './delete.js';
import { createValidateCommand } from './validate.js';
import { createDiffCommand } from './diff.js';
import { createRestoreCommand } from './restore.js';
import { createTagCommand } from './tag.js';
import { createExportAllCommand } from './export-all.js';
import { createImportCommand } from './import.js';

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow').alias('wf').description('Manage n8n workflows');
  cmd.addCommand(createListCommand());
  cmd.addCommand(createGetCommand());
  cmd.addCommand(createCreateCommand());
  cmd.addCommand(createUpdateCommand());
  cmd.addCommand(createActivateCommand());
  cmd.addCommand(createDeactivateCommand());
  cmd.addCommand(createTriggerWebhookCommand());
  cmd.addCommand(createBackupCommand());
  cmd.addCommand(createDeleteCommand());
  cmd.addCommand(createValidateCommand());
  cmd.addCommand(createDiffCommand());
  cmd.addCommand(createRestoreCommand());
  cmd.addCommand(createTagCommand());
  cmd.addCommand(createExportAllCommand());
  cmd.addCommand(createImportCommand());
  return cmd;
}
