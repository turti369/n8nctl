import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import axios from 'axios';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError, ApiError, NetworkError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { waitForExecution } from '../../lib/execution.js';
import type { Workflow } from '../../types/n8n.js';

interface TriggerOpts {
  data?: string;
  file?: string;
  wait?: boolean;
  timeout?: string;
  path?: string;
  method?: string;
  test?: boolean;
}

export function createTriggerWebhookCommand(): Command {
  return new Command('trigger-webhook')
    .alias('trigger')
    .description(
      'Trigger a workflow by hitting its webhook node URL ' +
        '(n8n Public API has no /execute endpoint — this is the correct way).',
    )
    .argument('<id>', 'workflow ID')
    .option('--data <json>', 'Inline JSON payload for the webhook body')
    .option('--file <path>', 'Read payload from JSON file')
    .option('--method <verb>', 'HTTP method (default: from webhook node config)')
    .option('--path <path>', 'Override webhook path (useful when multiple webhook nodes exist)')
    .option('--test', 'Use /webhook-test/ endpoint instead of /webhook/ (manual activation mode)')
    .option('--wait', 'Wait for the newest execution to finish after triggering')
    .option('--timeout <ms>', 'Timeout for --wait polling in ms (default: 120000)')
    .action(
      withAction<TriggerOpts>(async (factory, opts, args) => {
        const [id] = args;
        const client = await factory.client();

        const wf = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);

        const { node: webhookNode, total: webhookTotal } = findWebhookNode(wf, opts.path);
        if (!webhookNode) {
          throw new ValidationError(
            `Workflow "${wf.name}" has no webhook trigger node`,
            'Only webhook-triggered workflows can be invoked externally. For scheduled workflows, wait for the cron to fire; manual-trigger workflows can only be run from the n8n UI.',
          );
        }

        if (!opts.path && webhookTotal > 1) {
          factory.io.stderr.write(
            `${c.yellow('warning')}: workflow has ${webhookTotal} webhook nodes; picked "${webhookNode.name}". ` +
              `Use --path <path> to disambiguate.\n`,
          );
        }

        const params = webhookNode.parameters as {
          path?: string;
          httpMethod?: string;
        };
        const webhookPath = opts.path ?? params.path;
        const method = (opts.method ?? params.httpMethod ?? 'POST').toUpperCase();
        if (!webhookPath) {
          throw new ValidationError(`Webhook node "${webhookNode.name}" has no path configured`);
        }

        const auth = await factory.auth();
        const prefix = opts.test ? 'webhook-test' : 'webhook';
        const url = `${auth.host}/${prefix}/${encodeURIComponent(webhookPath)}`;

        let body: unknown = {};
        if (opts.file) {
          const raw = await fs.readFile(opts.file, 'utf8');
          body = parseJsonOrThrow(raw, opts.file);
        } else if (opts.data) {
          body = parseJsonOrThrow(opts.data, '--data');
        }

        if (factory.flags.dryRun) {
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would ${method} ${url} with ${JSON.stringify(body).length} bytes\n`,
          );
          return;
        }

        factory.io.stderr.write(`${c.dim('→')} ${method} ${url}\n`);
        const triggerStart = new Date();

        try {
          const resp = await axios.request({
            method,
            url,
            data: body,
            validateStatus: () => true,
            timeout: factory.flags.timeout ?? 30000,
          });
          if (resp.status >= 400) {
            throw new ApiError(
              `Webhook returned ${resp.status} ${resp.statusText}`,
              resp.status,
              resp.data,
              resp.status === 404 && !opts.test
                ? 'Try --test if the workflow is in "listen for test event" mode instead of active.'
                : undefined,
            );
          }
          factory.io.stderr.write(`${c.green('✓')} webhook accepted (HTTP ${resp.status})\n`);

          if (opts.wait) {
            const timeout = opts.timeout ? Number(opts.timeout) : 120000;
            const spinner = factory.io.spinner('Waiting for execution...').start();
            try {
              const execution = await waitForExecution(client, {
                workflowId: id,
                since: triggerStart,
                timeoutMs: timeout,
              });
              spinner.succeed(
                `Execution ${execution.id} ${execution.status === 'success' ? c.green('succeeded') : c.red(execution.status ?? 'finished')}`,
              );
              await printData(execution, { io: factory.io, opts: factory.flags });
            } catch (err) {
              spinner.fail(`${c.red((err as Error).message)}`);
              throw err;
            }
          } else if (!factory.flags.json && !factory.flags.jq && !factory.flags.template) {
            factory.io.stdout.write(JSON.stringify(resp.data, null, 2) + '\n');
          } else {
            await printData(resp.data, { io: factory.io, opts: factory.flags });
          }
        } catch (err) {
          if (err instanceof ApiError || err instanceof NetworkError) throw err;
          throw new NetworkError(`Webhook request failed: ${(err as Error).message}`);
        }
      }),
    );
}

function findWebhookNode(wf: Workflow, pathFilter?: string): { node: Workflow['nodes'][number] | null; total: number } {
  const webhookNodes = (wf.nodes ?? []).filter(
    (n) => n.type === 'n8n-nodes-base.webhook' && !n.disabled,
  );
  if (webhookNodes.length === 0) return { node: null, total: 0 };
  if (pathFilter) {
    const match = webhookNodes.find(
      (n) => (n.parameters as { path?: string }).path === pathFilter,
    );
    return { node: match ?? webhookNodes[0], total: webhookNodes.length };
  }
  return { node: webhookNodes[0], total: webhookNodes.length };
}

function parseJsonOrThrow(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ValidationError(`Invalid JSON in ${label}: ${(err as Error).message}`);
  }
}
