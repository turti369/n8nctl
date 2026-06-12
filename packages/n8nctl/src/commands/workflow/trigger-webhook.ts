import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError, ApiError, AssertionFailedError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { waitForExecution } from '../../lib/execution.js';
import { parsePositiveInt } from '../../lib/util.js';
import { redactExecutionData } from '../../lib/redact-execution.js';
import type { Factory } from '../../factory.js';
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
  expectStatus?: string | number;
  capture?: string;
  unsafeRawIo?: boolean;
}

/** Write the webhook response to disk (redacted unless --unsafe-raw-io). */
async function captureResponse(
  factory: Factory,
  file: string,
  payload: { status: number | null; body: unknown },
  unsafeRawIo: boolean | undefined,
): Promise<void> {
  const safe = unsafeRawIo ? payload : redactExecutionData(payload);
  await fs.writeFile(path.resolve(file), JSON.stringify(safe, null, 2), 'utf8');
  factory.io.stderr.write(
    `${c.dim('→')} captured webhook response → ${file}${unsafeRawIo ? ' (RAW — handle as secret)' : ' (redacted)'}\n`,
  );
}

export async function triggerWebhookHandler(
  factory: Factory,
  opts: TriggerOpts,
  args: string[],
): Promise<void> {
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

  // Pre-flight: production webhooks (/webhook/) only register when the
  // workflow is active. Test webhooks (/webhook-test/) only respond when
  // the n8n editor is "Listening for test event". Trying to trigger an
  // inactive workflow against /webhook/ returns 404 with a confusing
  // message; bail early with an actionable hint.
  if (!opts.test && !wf.active) {
    throw new ValidationError(
      `Workflow "${wf.name}" (${id}) is INACTIVE — production webhook is not registered`,
      `Activate first:    n8nctl workflow activate ${id}\n` +
        `       Or use --test:    n8nctl workflow trigger-webhook ${id} --test  (requires "Listen for test event" in n8n UI)\n` +
        `       Or in one shot:   n8nctl workflow update ${id} <file> --activate  /  workflow create <file> --activate`,
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

  let resp: unknown;
  if (opts.expectStatus !== undefined || opts.capture) {
    // Probe path: single-shot (no retry → no double-fire) with the exact
    // response status, so --expect-status can gate and --capture can record.
    const expected =
      opts.expectStatus !== undefined
        ? parsePositiveInt(opts.expectStatus, '--expect-status', 0, 100)
        : undefined;
    const probe = await client.webhookProbe(url, body, {
      method,
      headers,
      timeout: factory.flags.timeout,
    });
    resp = probe.body;
    if (opts.capture) {
      await captureResponse(factory, opts.capture, probe, opts.unsafeRawIo);
    }
    if (expected !== undefined) {
      if (probe.status !== expected) {
        throw new AssertionFailedError(
          `Webhook returned HTTP ${probe.status}, expected ${expected}`,
          typeof probe.body === 'string' ? probe.body.slice(0, 200) : JSON.stringify(probe.body)?.slice(0, 200),
        );
      }
      factory.io.stderr.write(`${c.green('✓')} webhook returned expected HTTP ${expected}\n`);
    } else if (probe.status >= 300) {
      throw new ApiError(`webhook returned ${probe.status}`, probe.status, probe.body);
    } else {
      factory.io.stderr.write(`${c.green('✓')} webhook accepted (HTTP ${probe.status})\n`);
    }
  } else {
    resp = await client.webhookRequest<unknown>(url, body, {
      method,
      headers,
      timeout: factory.flags.timeout,
    });
    factory.io.stderr.write(`${c.green('✓')} webhook accepted\n`);
  }

  if (opts.wait) {
    const timeout = parsePositiveInt(opts.timeout, '--timeout', 120000);
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

export function buildAuthHeaders(
  opts: Pick<TriggerOpts, 'authBearer' | 'authBasic' | 'authHeader'>,
): Record<string, string> {
  // Both flags write the same Authorization header — pre-0.6.0 basic silently
  // won because it was processed second.
  if (opts.authBearer && opts.authBasic) {
    throw new ValidationError(
      '--auth-bearer and --auth-basic are mutually exclusive (both set the Authorization header)',
    );
  }
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
    .option(
      '--expect-status <code>',
      'Assert the webhook responds with exactly this HTTP status (single-shot, no retry; mismatch exits 6)',
    )
    .option('--capture <file>', 'Write the webhook {status, body} to file (redacted by default)')
    .option('--unsafe-raw-io', 'Disable redaction in --capture output (handle file as a secret)')
    .action(withAction<TriggerOpts>(triggerWebhookHandler));
}
