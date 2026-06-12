import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import { parsePositiveInt } from '../../lib/util.js';
import type { Factory } from '../../factory.js';

interface RunOpts {
  trigger?: string;
  wait?: boolean;
  timeout?: string | number;
}

export async function runHandler(
  factory: Factory,
  opts: RunOpts,
  args: string[],
): Promise<void> {
  const [id] = args;

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would execute workflow ${c.bold(id)} via /rest run` +
        `${opts.trigger ? ` (trigger: "${opts.trigger}")` : ''}${opts.wait ? ' + wait' : ''}\n`,
    );
    return;
  }

  const sc = await factory.sessionClient();
  const { executionId } = await sc.runWorkflow(id, opts.trigger);
  factory.io.event(
    'workflow-run-started',
    { workflowId: id, executionId },
    `${c.green('✓')} started execution ${c.bold(executionId)} for workflow ${id}`,
  );

  if (!opts.wait) {
    await printData({ workflowId: id, executionId }, { io: factory.io, opts: factory.flags });
    return;
  }

  const timeoutMs = parsePositiveInt(opts.timeout, '--timeout', 120000);
  const exec = await sc.waitExecution(executionId, { timeoutMs });
  const status = String(exec.status ?? (exec.finished ? 'finished' : 'unknown')).toLowerCase();
  const ok = status === 'success';
  factory.io.event(
    'workflow-run-finished',
    { workflowId: id, executionId, status },
    `${ok ? c.green('✓') : c.red('✗')} execution ${c.bold(executionId)} → ${status}`,
  );
  await printData(
    { workflowId: id, executionId, status, finished: exec.finished ?? false },
    { io: factory.io, opts: factory.flags },
  );
  if (!ok) process.exitCode = 1;
}

export function createRunCommand(): Command {
  return new Command('run')
    .description(
      'Execute a workflow headless via the internal /rest "Execute Workflow" endpoint ' +
        '(session auth). The Public API has NO execute endpoint — use this for ' +
        'manual / scheduled / sub-workflow verification, or when the webhook router is ' +
        'stuck (n8n #21614). Requires `n8nctl auth login --session`.',
    )
    .argument('<id>', 'workflow ID')
    .option(
      '--trigger <name>',
      'Trigger node NAME to start from (required when a workflow has multiple triggers; ' +
        'pick a non-webhook trigger to avoid waiting for a webhook event)',
    )
    .option('--wait', 'Poll the resulting execution to a terminal state and report pass/fail (exit 1 on non-success)')
    .option('--timeout <ms>', 'Wait timeout in ms (default 120000)')
    .action(withAction<RunOpts>(runHandler));
}
