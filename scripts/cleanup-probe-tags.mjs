#!/usr/bin/env node
/**
 * One-off maintenance script: delete leftover doctor probe tags.
 *
 * Why this exists: pre-0.4.0 `n8nctl doctor` created a random-named tag
 * (`n8nctl-<random12>`) per run to probe write permission. On an API key
 * without DELETE scope these orphans accumulated. v0.4.0 stops the bleed
 * (fixed-name reuse) but cannot remove the historical orphans without a key
 * that has tag:delete scope. Run this once with a TEMPORARY full-scope key
 * to sweep them, then revoke that key.
 *
 * Auth: reads N8N_HOST + N8N_API_KEY from the environment. The key is NEVER
 * printed or passed via argv.
 *
 * Usage:
 *   node scripts/cleanup-probe-tags.mjs                 # dry-run (default), strict probes only
 *   node scripts/cleanup-probe-tags.mjs --include-doctorish   # also target n8nctl-doctor-* test junk
 *   node scripts/cleanup-probe-tags.mjs --apply         # actually DELETE (needs tag:delete scope)
 */

const HOST = process.env.N8N_HOST?.replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
const APPLY = process.argv.includes('--apply');
const INCLUDE_DOCTORISH = process.argv.includes('--include-doctorish');

if (!HOST || !KEY) {
  console.error('error: N8N_HOST and N8N_API_KEY must be set in the environment');
  process.exit(2);
}

const headers = {
  'X-N8N-API-KEY': KEY,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent': 'n8nctl-cleanup/0.4.0',
};

/** Strict probe: fixed name, or n8nctl- + exactly 12 base36 chars (legacy). */
const isStrictProbe = (name) =>
  name === 'n8nctl-doctor-probe' || /^n8nctl-[a-z0-9]{12}$/.test(name);

/** Doctor-ish test junk that isn't a strict probe (e.g. n8nctl-doctor-test-xyz). */
const isDoctorish = (name) =>
  /^n8nctl-doctor-/.test(name) && name !== 'n8nctl-doctor-probe';

async function fetchAllTags() {
  const tags = [];
  let cursor;
  do {
    const url = new URL(`${HOST}/api/v1/tags`);
    url.searchParams.set('limit', '250');
    if (cursor) url.searchParams.set('cursor', cursor);
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      throw new Error(`GET /tags → ${resp.status} ${resp.statusText}`);
    }
    const body = await resp.json();
    for (const t of body.data ?? []) tags.push(t);
    cursor = body.nextCursor ?? null;
  } while (cursor);
  return tags;
}

async function deleteTag(id) {
  const resp = await fetch(`${HOST}/api/v1/tags/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  });
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText}`);
  }
}

async function main() {
  console.log(`host: ${HOST}`);
  console.log(`mode: ${APPLY ? 'APPLY (will DELETE)' : 'dry-run (no changes)'}`);

  const all = await fetchAllTags();
  const strict = all.filter((t) => typeof t?.name === 'string' && isStrictProbe(t.name));
  const doctorish = all.filter((t) => typeof t?.name === 'string' && isDoctorish(t.name));

  const targets = INCLUDE_DOCTORISH ? [...strict, ...doctorish] : strict;

  console.log(`\ntotal tags on instance: ${all.length}`);
  console.log(`strict probe orphans:   ${strict.length}`);
  console.log(`doctor-ish test junk:   ${doctorish.length}${INCLUDE_DOCTORISH ? ' (included)' : ' (use --include-doctorish to also delete)'}`);
  console.log(`→ will ${APPLY ? 'DELETE' : 'target'}: ${targets.length} tag(s)\n`);

  for (const t of targets) console.log(`  - ${t.name} (${t.id})`);
  if (!INCLUDE_DOCTORISH && doctorish.length) {
    console.log('\n  (left in place — not strict probes):');
    for (const t of doctorish) console.log(`  · ${t.name} (${t.id})`);
  }

  if (!APPLY) {
    console.log('\ndry-run complete. Re-run with --apply (and a tag:delete-scoped key) to delete.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    try {
      await deleteTag(t.id);
      ok++;
      console.log(`  ✓ deleted ${t.name}`);
    } catch (err) {
      fail++;
      console.log(`  ✗ ${t.name}: ${err.message}`);
      if (/403|forbidden/i.test(err.message)) {
        console.log('\nstopped: this key lacks tag:delete scope. Use a temporary full-scope key.');
        break;
      }
    }
  }
  console.log(`\ndone: ${ok} deleted, ${fail} failed.`);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
