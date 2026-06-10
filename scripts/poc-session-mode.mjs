#!/usr/bin/env node
/**
 * POC: verify n8n /rest session-auth contract before building it into n8nctl.
 *
 * Pins the contract that Phase 0 of the session-mode plan gates on. Output of
 * a full run becomes scripts/SESSION_REST_CONTRACT.md.
 *
 * Auth: reads N8N_HOST + N8N_EMAIL + N8N_PASSWORD from env (session login).
 * Optional N8N_API_KEY enables the Public-API executions queryability check.
 * Credentials and the session cookie are NEVER printed.
 *
 * Probes (opt-in via flags so nothing mutates by accident):
 *   node scripts/poc-session-mode.mjs
 *       → login + whoami + exec-mode + CSRF detect            (read-only)
 *   node scripts/poc-session-mode.mjs --save <id>
 *       → echo-full-body PATCH save + before/after field diff (mutates that wf)
 *   node scripts/poc-session-mode.mjs --run <id>
 *       → POST /rest run, then GET /api/v1/executions/{id}     (executes that wf)
 *   node scripts/poc-session-mode.mjs --register <id> <webhookPath>
 *       → curl webhook (before), save, curl webhook (after)    (the load-bearing proof)
 */

const HOST = process.env.N8N_HOST?.replace(/\/+$/, '');
const EMAIL = process.env.N8N_EMAIL;
const PASSWORD = process.env.N8N_PASSWORD;
const API_KEY = process.env.N8N_API_KEY; // optional

const argv = process.argv.slice(2);
const flagVal = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const RUN_ID = flagVal('--run');
const SAVE_ID = flagVal('--save');
const REG_ID = flagVal('--register');
const REG_PATH = REG_ID ? argv[argv.indexOf('--register') + 2] : null;

if (!HOST || !EMAIL || !PASSWORD) {
  console.error('error: set N8N_HOST, N8N_EMAIL, N8N_PASSWORD in the environment');
  process.exit(2);
}

const JSONH = { 'Content-Type': 'application/json', Accept: 'application/json' };
/** full cookie jar (n8n may set more than n8n-auth) */
let cookieJar = [];
let csrfToken = null;

const cookieHeader = () => cookieJar.join('; ');
const short = (o, n = 600) => {
  const s = typeof o === 'string' ? o : JSON.stringify(o);
  return s.length > n ? s.slice(0, n) + '…' : s;
};
function captureCookies(resp) {
  const set = resp.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const nv = c.split(';')[0];
    const name = nv.split('=')[0];
    cookieJar = cookieJar.filter((j) => j.split('=')[0] !== name).concat(nv);
  }
  return set;
}

async function login() {
  // n8n used both {email} and {emailOrLdapLoginId} across versions — send both.
  const body = JSON.stringify({ email: EMAIL, emailOrLdapLoginId: EMAIL, password: PASSWORD });
  const resp = await fetch(`${HOST}/rest/login`, { method: 'POST', headers: JSONH, body });
  const set = captureCookies(resp);
  const payload = await resp.json().catch(() => ({}));
  console.log(`1. POST /rest/login → ${resp.status} ${resp.statusText}`);
  console.log(`   cookies set: [${set.map((c) => c.split('=')[0]).join(', ') || 'NONE'}]`);
  // record cookie attrs of the auth cookie (HttpOnly/SameSite/Max-Age) for contract
  const authRaw = set.find((c) => /^n8n-auth=/.test(c));
  if (authRaw) {
    const attrs = authRaw.split(';').slice(1).map((s) => s.trim()).filter(Boolean);
    console.log(`   n8n-auth attrs: ${attrs.join('; ') || '(none)'}`);
  }
  // canonical login key: re-probe with only {email} to see if it alone works
  if (payload?.data) {
    console.log(`   user: ${payload.data.email ?? '?'} role=${payload.data.role ?? payload.data.globalRole?.name ?? '?'}`);
  } else {
    console.log(`   body: ${short(payload)}`);
  }
  if (!resp.ok || cookieJar.length === 0) throw new Error('login failed — check creds / login key');
}

async function whoami() {
  const resp = await fetch(`${HOST}/rest/login`, { headers: { ...JSONH, Cookie: cookieHeader() } });
  const p = await resp.json().catch(() => ({}));
  console.log(`2. GET /rest/login (whoami) → ${resp.status}  valid=${resp.ok ? 'yes' : 'NO'} (${p?.data?.email ?? '?'})`);
}

async function detectExecModeAndCsrf() {
  const resp = await fetch(`${HOST}/rest/settings`, { headers: { ...JSONH, Cookie: cookieHeader() } });
  const p = await resp.json().catch(() => ({}));
  const d = p?.data ?? p ?? {};
  // n8n frontend settings expose hints about topology / queue mode.
  const modeHints = {
    versionCli: d.versionCli,
    executionMode: d.executionMode,
    pushBackend: d.pushBackend,
    isQueueModeEnabled: d.isQueueModeEnabled ?? d.executionMode === 'queue',
    enterprise: d.enterprise ? Object.keys(d.enterprise).filter((k) => d.enterprise[k]).slice(0, 6) : undefined,
  };
  console.log(`3. exec-mode/topology (GET /rest/settings → ${resp.status}):`);
  console.log(`   ${short(modeHints)}`);
  // CSRF detection: many n8n builds put a token in settings or require X-CSRF on POST.
  csrfToken = d.csrfToken ?? d.security?.csrfToken ?? null;
  const csrfCookie = cookieJar.find((c) => /csrf/i.test(c));
  console.log(`4. CSRF: settings token=${csrfToken ? 'present' : 'none'} cookie=${csrfCookie ? 'present' : 'none'}`);
  console.log(`   → if a mutating /save below returns 403, CSRF IS required (record header n8n expects).`);
}

async function getWorkflowRest(id) {
  const resp = await fetch(`${HOST}/rest/workflows/${encodeURIComponent(id)}`, {
    headers: { ...JSONH, Cookie: cookieHeader() },
  });
  if (!resp.ok) throw new Error(`GET /rest/workflows/${id} → ${resp.status}`);
  const p = await resp.json();
  return p.data ?? p;
}

function mutatingHeaders() {
  const h = { ...JSONH, Cookie: cookieHeader() };
  if (csrfToken) h['X-CSRF-TOKEN'] = csrfToken; // best-effort; confirm exact header name from 403
  return h;
}

async function curlWebhook(path) {
  const url = `${HOST}/webhook/${String(path).replace(/^\/+/, '')}`;
  try {
    const resp = await fetch(url, { method: 'POST', headers: JSONH, body: '{}' });
    return resp.status;
  } catch (e) {
    return `ERR ${e.message}`;
  }
}

async function testSave(id) {
  console.log(`\n5. SAVE probe on ${id} (echo-full-body PATCH)`);
  const before = await getWorkflowRest(id);
  const beforeKeys = Object.keys(before).sort();
  console.log(`   GET keys: [${beforeKeys.join(', ')}]`);
  console.log(`   versionId present: ${before.versionId ? 'YES (optimistic-lock candidate)' : 'no'}`);
  // Echo the FULL object back (the plan's whitelist-guess was rejected by review).
  const resp = await fetch(`${HOST}/rest/workflows/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: mutatingHeaders(),
    body: JSON.stringify(before),
  });
  console.log(`   PATCH /rest/workflows/${id} (full echo) → ${resp.status} ${resp.statusText}`);
  const p = await resp.json().catch(() => ({}));
  if (resp.status === 403) {
    console.log(`   → 403: CSRF/permission required. Inspect response: ${short(p)}`);
    return;
  }
  if (!resp.ok) {
    console.log(`   → FAIL body: ${short(p)}`);
    // retry with a minimal body to learn what's accepted
    return;
  }
  const after = p.data ?? p;
  // before/after field-drop diff (review f07/agent-f08)
  const afterKeys = Object.keys(after).sort();
  const dropped = beforeKeys.filter((k) => !afterKeys.includes(k));
  console.log(`   active: ${before.active} → ${after.active}`);
  console.log(`   versionId: ${before.versionId} → ${after.versionId} (changed=${before.versionId !== after.versionId})`);
  console.log(`   dropped keys after save: [${dropped.join(', ') || 'none ✓'}]`);
  console.log(`   node count: ${before.nodes?.length} → ${after.nodes?.length}`);
}

async function testRun(id) {
  console.log(`\n6. RUN probe on ${id}`);
  const wf = await getWorkflowRest(id);
  const resp = await fetch(`${HOST}/rest/workflows/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    headers: mutatingHeaders(),
    body: JSON.stringify({ workflowData: wf }),
  });
  console.log(`   POST /rest/workflows/${id}/run → ${resp.status} ${resp.statusText}`);
  const p = await resp.json().catch(() => ({}));
  const execId = p?.data?.executionId;
  console.log(`   executionId: ${execId ?? '(none) body: ' + short(p)}`);
  if (!execId) {
    console.log(`   → no executionId: run.ts must read result sync from body or poll /rest/executions`);
    return;
  }
  // review f02/codex-f04: confirm the Public API can read this execution by id
  if (!API_KEY) {
    console.log(`   (set N8N_API_KEY to test Public-API GET /executions/${execId} queryability)`);
    return;
  }
  // poll a few times — manual executions may take a moment / may not persist
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${HOST}/api/v1/executions/${execId}`, {
      headers: { 'X-N8N-API-KEY': API_KEY, Accept: 'application/json' },
    });
    if (r.status === 200) {
      const e = await r.json().catch(() => ({}));
      console.log(`   ✓ Public-API GET /executions/${execId} → 200 status=${e.status ?? e.finished ?? '?'} (queryable → waitForExecution OK)`);
      return;
    }
    if (r.status === 404 && i === 4) {
      console.log(`   ✗ Public-API GET /executions/${execId} → 404 (manual exec NOT persisted/visible → --wait must use /rest poll or sync body)`);
      return;
    }
    await new Promise((s) => setTimeout(s, 1500));
  }
}

async function testRegister(id, webhookPath) {
  console.log(`\n7. REGISTER proof on ${id} (webhook path: ${webhookPath})`);
  console.log(`   (run AFTER: create → API-activate → API-update nodes, to mirror the real pipeline)`);
  const beforeStatus = await curlWebhook(webhookPath);
  console.log(`   before save: POST /webhook/${webhookPath} → ${beforeStatus}  (expect 404 if stale)`);
  await testSave(id);
  // give the router a beat to register
  await new Promise((s) => setTimeout(s, 1500));
  const afterStatus = await curlWebhook(webhookPath);
  console.log(`   after save:  POST /webhook/${webhookPath} → ${afterStatus}  (expect 2xx if save registered)`);
  const proven = String(beforeStatus).startsWith('4') && String(afterStatus).startsWith('2');
  console.log(`   ⇒ SAVE re-registers webhook: ${proven ? 'PROVEN ✓' : 'NOT proven ✗ — value prop at risk'}`);
}

async function main() {
  console.log(`host: ${HOST}\n=== n8nctl session-mode POC ===`);
  await login();
  await whoami();
  await detectExecModeAndCsrf();
  if (REG_ID) await testRegister(REG_ID, REG_PATH);
  else {
    if (SAVE_ID) await testSave(SAVE_ID);
    if (RUN_ID) await testRun(RUN_ID);
  }
  console.log('\nPOC done. Paste this output (no secrets) into SESSION_REST_CONTRACT.md.');
  console.log('Still capture ONE real UI "Save" in browser DevTools → exact PATCH body + any X-CSRF header.');
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
