import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import https from 'node:https';
import { runWithRetry, type ClientEvent } from './transport.js';
import { ApiError, AuthError } from './errors.js';
import { USER_AGENT } from './version.js';
import { sleep } from './util.js';
import type { ResolvedSession } from './auth.js';
import type { Workflow } from '../types/n8n.js';

export interface SessionClientOptions {
  timeout?: number;
  insecure?: boolean;
  onEvent?: (e: ClientEvent) => void;
  /** Persist a freshly-minted cookie (e.g. to keyring) after login. */
  onCookie?: (cookie: string) => void | Promise<void>;
}

export interface RunResult {
  executionId: string;
}

export interface ExecutionState {
  id?: string;
  status?: string;
  finished?: boolean;
  [k: string]: unknown;
}

/**
 * Client for n8n's INTERNAL `/rest` API using session-cookie auth — the
 * endpoints the web UI itself calls. Used by `workflow run` to execute a
 * workflow headless (`POST /rest/workflows/{id}/run`, the "Execute Workflow"
 * button), which the Public API has no equivalent for and which bypasses the
 * webhook router entirely (n8n Issue #21614).
 *
 * Ported from the verified `n8n_session.py` reference + the autonomous-trigger
 * playbook. Body schema and pitfalls are pinned in scripts/SESSION_REST_CONTRACT.md.
 *
 * NOTE: /rest is internal + unversioned. Re-verify on n8n upgrades.
 */
export class N8nSessionClient {
  private readonly http: AxiosInstance;
  private readonly email: string;
  private readonly password?: string;
  private readonly retry: { maxRetries: number; baseBackoffMs: number; onEvent?: (e: ClientEvent) => void };
  private readonly onCookie?: (cookie: string) => void | Promise<void>;
  private cookie: string | null;
  /** Single-flight guard: concurrent 401s await ONE re-login, not N. */
  private reloginPromise: Promise<void> | null = null;
  readonly host: string;

  constructor(session: ResolvedSession, opts: SessionClientOptions = {}) {
    this.host = session.host;
    this.email = session.email;
    this.password = session.password;
    this.cookie = session.cookie ?? null;
    this.onCookie = opts.onCookie;
    this.retry = { maxRetries: 3, baseBackoffMs: 500, onEvent: opts.onEvent };

    const httpsAgent = opts.insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;
    this.http = axios.create({
      baseURL: `${session.host}/rest`,
      timeout: opts.timeout ?? 30000,
      validateStatus: () => true,
      httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
  }

  /**
   * POST /rest/login. Exempt from the 401-intercept wrapper to avoid recursion
   * on bad credentials. Captures the full cookie jar (n8n-auth + any others).
   */
  async login(): Promise<void> {
    if (!this.password) {
      throw new AuthError(
        'Session cookie expired and no password stored (cookie-only mode).',
        'Run `n8nctl auth login --session` again to re-authenticate.',
      );
    }
    // n8n used both {email} and {emailOrLdapLoginId} across versions — send both.
    const resp = await this.http.request({
      method: 'POST',
      url: '/login',
      data: { emailOrLdapLoginId: this.email, email: this.email, password: this.password },
    });
    if (resp.status !== 200) {
      const hint =
        resp.status === 401
          ? 'Wrong email/password.'
          : resp.status === 403
            ? 'User lacks permission (need workflow:execute / member role).'
            : undefined;
      throw new AuthError(`Session login failed: HTTP ${resp.status}`, hint);
    }
    const setCookie = resp.headers['set-cookie'] as string[] | undefined;
    const jar = (setCookie ?? []).map((c) => c.split(';')[0]).filter(Boolean);
    if (jar.length === 0) {
      throw new AuthError('Session login returned no cookie.');
    }
    this.cookie = jar.join('; ');
    await this.onCookie?.(this.cookie);
  }

  /** Single-flight re-login: all concurrent callers await the same login. */
  private async relogin(): Promise<void> {
    if (!this.reloginPromise) {
      this.reloginPromise = this.login().finally(() => {
        this.reloginPromise = null;
      });
    }
    return this.reloginPromise;
  }

  /** Request wrapper: attach cookie, on 401 re-login once (single-flight) and retry. */
  private async req<T>(config: AxiosRequestConfig, retried = false): Promise<T> {
    const cfg: AxiosRequestConfig = {
      ...config,
      headers: { ...(config.headers ?? {}), Cookie: this.cookie ?? '' },
    };
    try {
      return await runWithRetry<T>(this.http, cfg, 'n8n /rest', this.retry);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && !retried) {
        await this.relogin();
        return this.req<T>(config, true);
      }
      throw err;
    }
  }

  /** Ensure we have a valid session before a run (login if no cookie yet). */
  async ensureSession(): Promise<void> {
    if (!this.cookie) await this.relogin();
  }

  async whoami(): Promise<{ email?: string; role?: string }> {
    const r = await this.req<{ data?: { email?: string; role?: string } }>({
      method: 'GET',
      url: '/login',
    });
    return r.data ?? {};
  }

  async getWorkflowRest(id: string): Promise<Workflow> {
    const r = await this.req<{ data?: Workflow }>({
      method: 'GET',
      url: `/workflows/${encodeURIComponent(id)}`,
    });
    return expectRestObject<Workflow>(r?.data ?? r, `workflow ${id}`);
  }

  /**
   * Execute a workflow via the UI "Execute Workflow" endpoint.
   * Body schema (ManualRunPayload, FullManualExecutionFromKnownTrigger):
   *   { workflowData: <full wf>, triggerToStartFrom: { name } }
   * Pitfalls (from playbook): NEVER send `runData: {}` (→ Partial variant →
   * HTTP 500); pick a NON-webhook trigger or n8n returns waitingForWebhook.
   */
  async runWorkflow(id: string, triggerName?: string): Promise<RunResult> {
    const wf = await this.getWorkflowRest(id);
    const trigger = triggerName ?? pickTrigger(wf);
    const body: Record<string, unknown> = { workflowData: wf };
    if (trigger) body.triggerToStartFrom = { name: trigger };

    const r = await this.req<{ data?: { executionId?: string | number; waitingForWebhook?: boolean } }>({
      method: 'POST',
      url: `/workflows/${encodeURIComponent(id)}/run`,
      data: body,
    });
    const d = r.data ?? {};
    if (d.waitingForWebhook) {
      throw new ApiError(
        'Workflow is waiting for a webhook event — cannot execute headless.',
        200,
        d,
        trigger
          ? `Trigger "${trigger}" is a webhook. Pass --trigger <non-webhook trigger name>.`
          : 'Pass --trigger <trigger node name> to start from a non-webhook trigger.',
      );
    }
    if (d.executionId === undefined || d.executionId === null) {
      throw new ApiError('Run accepted but no executionId returned.', 200, d);
    }
    return { executionId: String(d.executionId) };
  }

  async getExecution(execId: string): Promise<ExecutionState> {
    const r = await this.req<{ data?: ExecutionState }>({
      method: 'GET',
      url: `/executions/${encodeURIComponent(execId)}`,
    });
    return expectRestObject<ExecutionState>(r?.data ?? r, `execution ${execId}`);
  }

  /**
   * Retry a (usually failed) execution via the internal `/rest` endpoint the UI
   * "Retry" button hits. The Public API v1 has NO execution-retry endpoint —
   * only /rest does. Body `{ loadWorkflow }` is OPTIONAL: omitted → retry with
   * the execution's saved workflow data; `true` → reload the current saved
   * workflow. Returns the new execution object.
   * Contract pinned in scripts/SESSION_REST_CONTRACT.md.
   */
  async retryExecution(execId: string, loadWorkflow = false): Promise<ExecutionState> {
    const r = await this.req<{ data?: ExecutionState }>({
      method: 'POST',
      url: `/executions/${encodeURIComponent(execId)}/retry`,
      data: { loadWorkflow },
    });
    return expectRestObject<ExecutionState>(r?.data ?? r, `retry of execution ${execId}`);
  }

  /** Poll /rest/executions/{id} to a terminal state (robust vs saveManualExecutions). */
  async waitExecution(execId: string, opts: { timeoutMs: number; pollMs?: number }): Promise<ExecutionState> {
    const poll = opts.pollMs ?? 2000;
    const deadline = Date.now() + opts.timeoutMs;
    const TERMINAL = new Set(['success', 'error', 'canceled', 'crashed']);
    while (Date.now() < deadline) {
      const e = await this.getExecution(execId);
      const status = String(e.status ?? '').toLowerCase();
      if (e.finished || TERMINAL.has(status)) return e;
      await sleep(Math.min(poll, deadline - Date.now()));
    }
    throw new ApiError(`Timeout after ${opts.timeoutMs}ms waiting for execution ${execId}`, 0);
  }
}

/** A node is a trigger if its type marks it as one. */
export function isTriggerNode(node: { type?: string }): boolean {
  const t = (node.type ?? '').toLowerCase();
  return t.includes('trigger') || t.includes('webhook');
}

/**
 * Choose which trigger to start a manual run from. Prefer a non-webhook
 * trigger (webhook triggers cause waitingForWebhook). Returns undefined when
 * there are no triggers (n8n will figure it out) or to let n8n auto-pick a
 * single trigger.
 */
export function pickTrigger(wf: { nodes?: Array<{ name: string; type?: string; disabled?: boolean }> }): string | undefined {
  const triggers = (wf.nodes ?? []).filter((n) => !n.disabled && isTriggerNode(n));
  if (triggers.length === 0) return undefined;
  if (triggers.length === 1) return triggers[0].name;
  const nonWebhook = triggers.find((t) => !/webhook/i.test(t.type ?? ''));
  return (nonWebhook ?? triggers[0]).name;
}

/**
 * Runtime shape guard for /rest responses. The internal API is unversioned:
 * some n8n versions wrap payloads in `{ data }`, others return them bare. The
 * old `(r.data ?? r) as T` double-cast accepted ANY shape and failed with
 * cryptic downstream errors when /rest changed — now we fail loudly here.
 */
function expectRestObject<T>(value: unknown, what: string): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    throw new ApiError(
      `Unexpected /rest response shape for ${what} — expected an object, got ${value === null ? 'null' : typeof value}`,
      0,
      value,
      'The internal /rest API is unversioned and may have changed in this n8n version.',
    );
  }
  return value as T;
}
