import type { N8nClient } from './api.js';
import type { Execution, PaginatedResponse } from '../types/n8n.js';
import { ApiError } from './errors.js';
import { sleep } from './util.js';

export interface WaitOptions {
  workflowId?: string;
  executionId?: string;
  since?: Date;
  timeoutMs: number;
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL = 2000;
const TERMINAL_STATUSES = new Set(['success', 'error', 'canceled', 'crashed']);

export async function waitForExecution(
  client: N8nClient,
  opts: WaitOptions,
): Promise<Execution> {
  const start = Date.now();
  const poll = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const deadline = start + opts.timeoutMs;

  while (Date.now() < deadline) {
    const execution = await fetchNewest(client, opts);
    if (execution) {
      const status = (execution.status ?? '').toLowerCase();
      if (execution.finished || TERMINAL_STATUSES.has(status)) {
        return execution;
      }
    }
    await sleep(Math.min(poll, deadline - Date.now()));
  }

  throw new Error(
    `Timeout after ${opts.timeoutMs}ms waiting for execution ` +
      (opts.executionId ? `${opts.executionId}` : `of workflow ${opts.workflowId}`),
  );
}

async function fetchNewest(client: N8nClient, opts: WaitOptions): Promise<Execution | null> {
  if (opts.executionId) {
    try {
      return await client.get<Execution>(`/executions/${encodeURIComponent(opts.executionId)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  const resp = await client.get<PaginatedResponse<Execution>>('/executions', {
    workflowId: opts.workflowId,
    limit: 5,
  });

  const candidates = opts.since
    ? resp.data.filter((e) => {
        const startedAt = e.startedAt ? new Date(e.startedAt).getTime() : 0;
        return startedAt >= opts.since!.getTime() - 2000;
      })
    : resp.data;

  return candidates[0] ?? null;
}

export async function getLastError(
  client: N8nClient,
  workflowId: string,
): Promise<Execution | null> {
  const resp = await client.get<PaginatedResponse<Execution>>('/executions', {
    workflowId,
    status: 'error',
    limit: 1,
    includeData: true,
  });
  return resp.data[0] ?? null;
}

