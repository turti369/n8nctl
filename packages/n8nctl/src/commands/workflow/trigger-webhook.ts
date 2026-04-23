import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
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
  authBearer?: string;
  authBasic?: string;
  authHeader?: string[];
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
    .option('--test', 'Use /webhook-test/ endpoint (workflow in "listen for test event" mode)')
    .option('--wait', 'Wait for the newest execution to finish after triggering')
    .option('--timeout <ms>', 'Timeout for --wait polling in ms (default: 120000)')
    .option('--auth-bearer <token>', 'Send Authorization: Bearer <token>')
    .option('--auth-basic <user:pass>', 'Send HTTP Basic auth (user:password)')
    .option(
      '--auth-header <header>',
      'Send custom auth header "Name: Value". Repeatable.',
      (value: string, prev: string[] = []) => [...prev, value],
    )
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
          authentication?: string;
        };
        const webhookPath = opts.path ?? params.path;
        const method = (opts.method ?? params.httpMethod ?? 'POST').toUpperCase();
        if (!webhookPath) {
          throw new ValidationError(`Webhook node "${webhookNode.name}" has no path configured`);
        }

        // Warn when webhook requires auth but user did not pass --auth-*
        const hasAuthFlags =
          opts.authBearer || opts.authBasic || (opts.authHeader && opts.authHeader.length > 0);
        if (
          params.authentication &&
          params.authentication !== 'none' &&
          !hasAuthFlags
        ) {
          factory.io.stderr.write(
            `${c.yellow('warning')}: webhook node requires "${params.authentication}" auth but no --auth-* flag was provided. ` +
              `Request will likely be rejected.\n`,
          );
        }

        const prefix = opts.test ? 'webhook-test' : 'webhook';
        const url = `${client.host}/${prefix}/${encodePathSegments(webhookPath)}`;

        let body: unknown = {};
        if (opts.file) {
          const raw = await fs.readFile(opts.file, 'utf8');
          body = parseJsonOrThrow(raw, opts.file);
        } else if (opts.data) {
          body = parseJsonOrThrow(opts.data, '--data');
        }

        const headers = buildAuthHeaders(opts);

        if (factory.flags.dryRun) {
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would ${method} ${url} ` +
              `with ${JSON.stringify(body).length} bytes` +
              (Object.keys(headers).length > 0 ? ` and auth headers` : '') +
              `\n`,
          );
          return;
        }

        factory.io.stderr.write(`${c.dim('→')} ${method} ${url}\n`);
        // Capture trigger timestamp with 30s buffer to absorb client-server
        // clock skew (NTP drift, VM hibernation). Without this, we risk
        // filtering out the very execution we just triggered.
        const triggerStart = new Date();
        const clockSkewBufferMs = 30_000;

        const resp = await client.webhookRequest<unknown>(url, body, {
          method,
          headers,
          timeout: factory.flags.timeout,
        });
        factory.io.stderr.write(`${c.green('✓')} webhook accepted\n`);

        if (opts.wait) {
          const timeout = opts.timeout ? Number(opts.timeout) : 120000;
          const spinner = factory.io.spinner('Waiting for execution...').start();
          try {
            const execution = await waitForExecution(client, {
              workflowId: id,
              since: new Date(triggerStart.getTime() - clockSkewBufferMs),
              timeoutMs: timeout,
            });
            spinner.succeed(
              `Execution ${execution.id} ${execution.status === 'success' ? c.green('succeeded') : c.red(execution.status ?? 'finished')}`,
            );
            await printData(execution, { io: factory.io, opts: factory.flags });
            if (execution.status && execution.status !== 'success') {
              process.exitCode = 1;
            }
          } catch (err) {
            spinner.fail(`${c.red((err as Error).message)}`);
            throw err;
          }
        } else if (!factory.flags.json && !factory.flags.jq && !factory.flags.template) {
          factory.io.stdout.write(JSON.stringify(resp, null, 2) + '\n');
        } else {
          await printData(resp, { io: factory.io, opts: factory.flags });
        }
      }),
    );
}

function findWebhookNode(
  wf: Workflow,
  pathFilter?: string,
): { node: Workflow['nodes'][number] | null; total: number } {
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

/**
 * Encode each path segment separately so "/" remains structural while
 * unsafe characters inside a segment get escaped. `encodeURIComponent`
 * on the whole path would turn "/" into %2F and break routing.
 */
export function encodePathSegments(path: string): string {
  return path
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

function buildAuthHeaders(opts: TriggerOpts): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts.authBearer) {
    headers['Authorization'] = `Bearer ${opts.authBearer}`;
  }
  if (opts.authBasic) {
    const encoded = Buffer.from(opts.authBasic, 'utf8').toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  }
  if (opts.authHeader) {
    for (const raw of opts.authHeader) {
      const idx = raw.indexOf(':');
      if (idx === -1) {
        throw new ValidationError(
          `Invalid --auth-header value "${raw}" — expected "Name: Value"`,
        );
      }
      const name = raw.slice(0, idx).trim();
      const value = raw.slice(idx + 1).trim();
      if (!name) {
        throw new ValidationError(`Empty header name in --auth-header "${raw}"`);
      }
      headers[name] = value;
    }
  }
  return headers;
}
