import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { Execution, PaginatedResponse } from '../../types/n8n.js';

interface WatchOpts {
  workflow?: string;
  status?: string;
  interval?: string;
}

export function createWatchCommand(): Command {
  return new Command('watch')
    .description('Tail executions in realtime (polls /executions, emits new rows as they arrive)')
    .option('--workflow <id>', 'Filter to one workflow')
    .option('--status <s>', 'Filter by status (error|success|running|waiting|canceled|crashed)')
    .option('--interval <ms>', 'Poll interval in ms (default: 3000, min 1000)')
    .action(
      withAction<WatchOpts>(async (factory, opts) => {
        const client = await factory.client();
        const pollMs = Math.max(1000, Number(opts.interval ?? 3000));

        const seen = new Set<string>();
        const params: Record<string, unknown> = { limit: 20 };
        if (opts.workflow) params.workflowId = opts.workflow;
        if (opts.status) params.status = opts.status;

        factory.io.stderr.write(
          `${c.dim('→ watching executions')} (poll ${pollMs}ms, Ctrl+C to stop)\n`,
        );

        // Prime: mark the current top-of-list as already seen so we only
        // emit NEW executions going forward.
        const prime = await client.get<PaginatedResponse<Execution>>('/executions', params);
        for (const e of prime.data) seen.add(e.id);

        let stopped = false;
        const stop = (): void => {
          stopped = true;
          factory.io.stderr.write(`\n${c.dim('watch stopped')}\n`);
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);

        while (!stopped) {
          try {
            const resp = await client.get<PaginatedResponse<Execution>>('/executions', params);
            for (const e of resp.data.slice().reverse()) {
              if (seen.has(e.id)) continue;
              seen.add(e.id);
              emitRow(factory.io.stdout, e);
            }
          } catch (err) {
            factory.io.stderr.write(`${c.yellow('poll error')}: ${(err as Error).message}\n`);
          }
          if (stopped) break;
          await sleep(pollMs);
        }
      }),
    );
}

function emitRow(stream: NodeJS.WriteStream, e: Execution): void {
  const ts = (e.startedAt ?? '').slice(11, 19);
  const status = (e.status ?? (e.finished ? 'finished' : 'running')).toLowerCase();
  const colorize =
    status === 'success'
      ? c.green
      : status === 'error' || status === 'crashed'
        ? c.red
        : status === 'canceled'
          ? c.yellow
          : c.dim;
  const line = `${c.dim(ts)}  ${colorize(status.padEnd(8))}  ${c.bold(e.id)}  workflow=${e.workflowId}`;
  stream.write(line + '\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
