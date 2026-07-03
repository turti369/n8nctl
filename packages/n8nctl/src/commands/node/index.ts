import { Command } from 'commander';
import { createNodeListCommand } from './list.js';
import { createNodeDescribeCommand } from './describe.js';
import { createNodeSearchCommand } from './search.js';

export function createNodeCommand(): Command {
  const cmd = new Command('node')
    .description('Inspect node types from THIS instance’s live catalog (incl. community nodes)');
  cmd.addCommand(createNodeListCommand());
  cmd.addCommand(createNodeDescribeCommand());
  cmd.addCommand(createNodeSearchCommand());
  return cmd;
}
