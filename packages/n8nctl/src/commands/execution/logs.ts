import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { redactExecutionData } from '../../lib/redact-execution.js';
import type { Factory } from '../../factory.js';

interface LogsOpts {
  node?: string;
  errorsOnly?: boolean;
  ioData?: boolean;
  unsafeRawIo?: boolean;
}

interface RunEntry {
  error?: { message?: string; name?: string; description?: string };
  executionTime?: number;
  startTime?: number;
  data?: { main?: Array<Array<{ json?: unknown }> | null> };
}

interface NodeLog {
  node: string;
  run: number;
  status: 'ok' | 'error';
  durationMs?: number;
  items: number;
  error?: string;
  output?: unknown;
}

/** Per-item IO is trimmed so huge payloads do not flood the terminal/agent. */
const IO_CHAR_LIMIT = 2000;

function trimIo(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json.length <= IO_CHAR_LIMIT) return value;
  return { _truncated: true, _chars: json.length, preview: json.slice(0, IO_CHAR_LIMIT) };
}

export async function logsHandler(
  factory: Factory,
  opts: LogsOpts,
  args: string[],
): Promise<void> {
  const [id] = args;
  const client = await factory.client();
  const exec = await client.get<{
    id: string;
    status?: string;
    finished?: boolean;
    data?: { resultData?: { runData?: Record<string, RunEntry[]>; lastNodeExecuted?: string; error?: { message?: string } } };
  }>(`/executions/${encodeURIComponent(id)}`, { includeData: true });

  const resultData = exec.data?.resultData;
  if (!resultData || !resultData.runData) {
    throw new ValidationError(
      `Execution ${id} has no run data — nothing to show`,
      "Execution data was pruned or saving is disabled (settings saveDataSuccessExecution/saveDataErrorExecution). Re-run with saving enabled.",
    );
  }

  let rows: NodeLog[] = [];
  for (const [nodeName, runs] of Object.entries(resultData.runData)) {
    (runs ?? []).forEach((run, ri) => {
      const items = run?.data?.main?.[0]?.length ?? 0;
      const row: NodeLog = {
        node: nodeName,
        run: ri,
        status: run?.error ? 'error' : 'ok',
        durationMs: run?.executionTime,
        items,
      };
      if (run?.error) {
        row.error = run.error.message ?? run.error.name ?? 'error';
      }
      if (opts.ioData) {
        row.output = trimIo(run?.data?.main?.[0] ?? []);
      }
      rows.push(row);
    });
  }

  if (opts.node) {
    rows = rows.filter((r) => r.node === opts.node);
    if (rows.length === 0) {
      throw new ValidationError(
        `Node "${opts.node}" not found in execution ${id}`,
        `Nodes that ran: ${Object.keys(resultData.runData).join(', ')}`,
      );
    }
  }
  if (opts.errorsOnly) {
    rows = rows.filter((r) => r.status === 'error');
  }

  const payload = {
    executionId: exec.id,
    status: exec.status ?? (exec.finished ? 'finished' : 'running'),
    lastNodeExecuted: resultData.lastNodeExecuted,
    workflowError: resultData.error?.message,
    nodes: rows,
  };

  // Execution IO carries runtime values (HTTP responses, decrypted creds) —
  // redact by default; --unsafe-raw-io to bypass.
  const safe = opts.unsafeRawIo ? payload : redactExecutionData(payload);
  if (opts.unsafeRawIo) {
    factory.io.stderr.write(`${c.yellow('warning')}: --unsafe-raw-io — output may contain live secrets\n`);
  }

  await printData(safe, { io: factory.io, opts: factory.flags }, (d) => {
    const p = d as typeof payload;
    const tableRows = p.nodes.map((r) => [
      r.status === 'ok' ? c.green('ok') : c.red('error'),
      r.node + (r.run > 0 ? `[${r.run}]` : ''),
      r.durationMs !== undefined ? `${r.durationMs}ms` : '-',
      String(r.items),
      r.error ?? '',
    ]);
    return { head: ['STATUS', 'NODE', 'TIME', 'ITEMS', 'ERROR'], rows: tableRows };
  });

  if (rows.some((r) => r.status === 'error')) {
    process.exitCode = 1;
  }
}

export function createLogsCommand(): Command {
  return new Command('logs')
    .description(
      'Compact per-node view of an execution (status, duration, item counts, errors). ' +
        'Replaces --jq gymnastics in the debug loop. IO is redacted by default.',
    )
    .argument('<id>', 'execution ID')
    .option('--node <name>', 'Show only this node')
    .option('--errors-only', 'Show only failed node runs')
    .option('--io-data', 'Include per-node output items (redacted, trimmed)')
    .option('--unsafe-raw-io', 'Disable redaction of IO data (output may contain live secrets)')
    .action(withAction<LogsOpts>(logsHandler));
}
