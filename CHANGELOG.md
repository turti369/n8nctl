# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-04-28

Tier S agent-observability features driven by an external comparative
audit against `gh`, `stripe`, `aws`, `gws`. Goal: close the three gaps
that genuinely matter when an LLM (Claude Code, agent harness) is the
primary CLI consumer.

### Added

- **`--log-format <text|ndjson>` global flag** (also `N8NCTL_LOG_FORMAT`
  env). NDJSON mode emits one JSON object per stderr event so an agent
  can parse progress without regex. Events: `http-request`,
  `http-response`, `http-retry`, `http-error`, `tls-verification-disabled`.
  Each event has `ts`, `level`, plus per-event payload (label, method,
  url, status, durationMs, attempt). Spinners are auto-disabled in
  NDJSON mode to avoid polluting the event stream.

- **`doctor --verbose`** appends a "Server stats" section: n8n version
  (from `x-n8n-version` header if exposed), GET /workflows latency p50
  with 5 raw samples, total/active workflow counts, last-50 execution
  counts + failure rate, rate-limit headers. Lets agents make informed
  decisions ("backoff because we're at 90% rate limit" vs "proceed").

- **`workflow schema [--node <type>] [--list]`** — first-class schema
  introspection. Without flags: returns the Workflow resource shape
  (required/optional fields, read-only fields, an example workflow).
  `--node http` (or any short alias / full type): returns required,
  optional, enums, and conditionalRequired from the offline catalog.
  `--list`: enumerates all 21 node types in the catalog with version.
  Solves the agent-fabrication-of-field-names problem the CLI was
  originally built to address.

### Changed

- N8nClient now accepts an `onEvent` callback (used internally by the
  factory). HTTP requests/retries/errors fan out structured events
  through this hook, which the IO layer renders as text or NDJSON
  based on the active format. No public API change for command code.
- `process.env.N8NCTL_TRACE=1` continues to work as a separate text-mode
  trace channel; redundant when `--log-format=ndjson` is used.

## [0.2.5] — 2026-04-26

### Added

- **`workflow status <id>`** — first-class command for "is this workflow
  active?" Pretty output by default (active badge, tags, webhook URLs,
  last execution, exit code mapped to active state). `--json` / `--jq` /
  `--template` work as on every other command. `--exit` forces exit code
  semantics even in TTY (useful for `if n8nctl wf status 42; then ...`).
  Replaces the previous workaround of `workflow get <id> --jq '.active'`.
- **`workflow refresh <id>`** — workaround for the n8n bug where webhook
  routes go stale after a workflow is updated via API while active.
  Performs `deactivate → wait <ms> → activate`. Default delay 500ms.
  Bails (exit 1) if workflow is inactive, with a hint to call `activate`
  instead. Honors `--dry-run`.

### Why these were needed

A pipeline that did `workflow update --activate → trigger-webhook` saw
n8n report `active: true` but the webhook URL still 404'd. The webhook
router on the n8n side caches handlers tied to the workflow version at
the moment of activation. Updating in place doesn't invalidate the
cache. Cycling deactivate→activate forces re-registration.

The other failure mode this addresses: external tooling (slash commands,
other Claude sessions) reaching for the raw n8n API to check workflow
state, because the existing `workflow get --jq '.active'` wasn't
discoverable enough. `workflow status <id>` puts state checks on the
expected first-class surface.

## [0.2.4] — 2026-04-26

### Added

- **`workflow create --activate` and `workflow update --activate`** — new
  flag activates the workflow immediately after the create/update succeeds.
  Useful for CI/CD pipelines that need the production webhook to register
  in the same step. Without this flag a workflow ships as `active: false`
  and any `trigger-webhook` against it returns 404 because the webhook URL
  was never bound.

### Changed

- **`workflow trigger-webhook` now pre-checks `workflow.active`.** If a
  user tries to trigger the production endpoint of an inactive workflow,
  the CLI now bails with a `ValidationError` (exit 3) and a hint instead
  of forwarding a confusing 404 from n8n. The hint shows three escape
  hatches:
    n8nctl workflow activate <id>
    n8nctl workflow trigger-webhook <id> --test  (requires UI listener)
    n8nctl workflow update <id> <file> --activate  (atomic deploy+activate)

  Background: n8n only registers the `/webhook/<path>` URL when the
  workflow is active. The new pre-check turns a silent failure mode that
  surfaced in real CI runs into an actionable error.

## [0.2.3] — 2026-04-26

### Fixed

- **`workflow backup --dry-run` now respects the flag.** Previously it
  always wrote the backup file regardless of `--dry-run`. The output
  directory is also no longer created on dry-run.
- **`auth login` no longer prompts when credentials come from env vars
  or program-global flags.** Commander declares `--host` / `--api-key` /
  `--profile` both at the program level (with env fallback) AND on the
  `auth login` subcommand — the values do not merge across scopes. The
  subcommand now falls back to the global flags via `factory.flags` when
  its own option is undefined, so all three of these now skip prompts:
  - `n8nctl auth login --host X --api-key Y`
  - `n8nctl --host X --api-key Y auth login`
  - `N8N_HOST=X N8N_API_KEY=Y n8nctl auth login`

No code changes in `@trngthnh369/n8n-workflow-validator`; published in
lock-step with the CLI.

## [0.2.2] — 2026-04-24

### Added

- **`@trngthnh369/n8n-workflow-validator`**: node catalog bumped from
  v1.0.0 to v1.1.0 with typeVersions observed on a live Pierre Cardin VN
  n8n instance. Eliminates false-positive E060 warnings for workflows
  using current n8n releases:
  - `n8n-nodes-base.googleSheets`: added **4.5, 4.6, 4.7**
  - `n8n-nodes-base.merge`: added **3.2**
  - `n8n-nodes-base.scheduleTrigger`: added **1.3**
  - `@n8n/n8n-nodes-langchain.openAi`: added **1.7, 1.8**

### Changed

- Node catalog `_meta.version` now tracks independently of package version
  + includes a short `changelog` object explaining each catalog bump.

## [0.2.1] — 2026-04-24

Tag exists for historical purposes but was never published to npm —
GitHub Actions was disabled at the account level during this window, so
the tag-triggered release pipeline did not fire. See v0.2.2 for the first
release that actually ships.

### Changed (would-have-been)

- Release pipeline rewritten for monorepo tag-triggered publish with
  provenance. Ready to ship as soon as Actions is re-enabled.

### Changed

- **Release pipeline now automated.** Tag `v*.*.*` push on `main` triggers
  the `release.yml` workflow, which runs tests, publishes both packages
  with `--provenance`, and creates a GitHub Release from the matching
  `CHANGELOG.md` section. No more manual `npm publish` or shared tokens.
- **npm provenance attestation** is now emitted for every release.
  Visible as a badge on the npm package page linking to the exact
  GitHub commit that built the tarball.
- Workflow binds to GitHub environment `N8NCTL` reading
  `secrets.N8NCTL_TOKEN` (environment-scoped, narrower than repo-level).

### Internal

- Added `RELEASING.md` documenting the procedure and semver guidance.
- Added `npm audit --omit=dev` check to CI (warn-only).

## [0.2.0] — 2026-04-23

Security hardening + reliability + test coverage + DX improvements. Motivated
by a post-v0.1.0 external audit plus meta-challenge of the audit itself.

### Added

#### `@trngthnh369/n8nctl`

- **`--redact` flag** for `workflow get` and `workflow list`. Scrubs `pinData`
  (cached API responses with user PII), `credentials.<type>.name` (keeps `id`
  for reference), and `webhookId` at any nesting depth.
- **Webhook auth passthrough** on `workflow trigger-webhook`:
  - `--auth-bearer <token>` → `Authorization: Bearer <token>`
  - `--auth-basic <user:pass>` → HTTP Basic
  - `--auth-header "Name: Value"` (repeatable) → custom headers
  - Warns when webhook node has `authentication != "none"` but no auth flag
    was supplied.
- **`workflow watch`** — tail executions in realtime via polling. Optional
  `--workflow <id>` / `--status <s>` / `--interval <ms>` filters.
- **`n8nctl completion <shell>`** — generate bash / zsh / fish / powershell
  completion scripts.
- **Stdin support** for `workflow create -` / `workflow update <id> -` —
  kubectl-style pipe-friendly deployments.
- **Doctor write-permission probe** — `doctor` now posts + deletes a probe
  tag to distinguish read-only vs read-write API keys. Reveals whether the
  key can also DELETE tags. Probe name stays under 19 chars to respect n8n's
  (undocumented) 24-char tag name limit.
- **N8NCTL_TRACE=1** env var — logs every HTTP request with method, URL,
  status, attempt number. Useful for debugging retry behavior.

#### `@trngthnh369/n8n-workflow-validator`

- **13 new secret patterns** (Layer 4): GitHub `ghp_/gho_/ghu_/ghs_/ghr_`,
  Stripe `sk_live_/rk_live_`, OpenAI `sk-`, Anthropic `sk-ant-`, PEM private
  keys (RSA/EC/DSA/OPENSSH/PGP/ENCRYPTED/generic), OpenSSH key header,
  AWS session token `ASIA`.
- **`conditionalRequired` schema enforcement** (Layer 6): types like
  `pythonCode: { when: { language: 'python' }, type: 'string' }` are now
  checked. New error codes `E065` (missing) and `E066` (wrong type).

### Changed

- **`workflow trigger-webhook` uses `N8nClient` infrastructure** instead of
  a raw axios call — inherits retry, backoff, timeout, insecure handling,
  and N8NCTL_TRACE logging. Transient 502/503 during n8n restart now auto-
  retry.
- **Clock skew buffer extended 2s → 30s** in `waitForExecution`. Absorbs
  NTP drift between client and server clocks (Windows dev machines,
  hibernating VMs, Docker hosts without time sync).
- **Webhook path encoding** now splits on `/` and encodes each segment
  separately — preserves multi-segment paths like `api/users` instead of
  turning `/` into `%2F`.
- **Handlebars templates are sandboxed per-render** via `Handlebars.create()`
  instead of mutating a global singleton. Also catches render errors and
  surfaces them as `ValidationError`.
- **Error messages are ANSI-scrubbed** before stderr output — untrusted API
  error bodies can no longer inject terminal escape sequences.
- **User-Agent** bumped to `n8nctl/0.2.0`.

### Security

- **npm provenance enabled.** Both published packages now carry Sigstore
  provenance attestation — verifiable supply chain from GitHub Actions to
  npm. Badge visible on the npm package page.

### Internal

- Test suite expanded from 31 → 140 tests (+109).
  - `lib/api.ts`: 0% → **90.62%** line coverage (retry, backoff, pagination,
    webhook, error paths).
  - `lib/config.ts`: 0% → **87.23%** (incl. concurrent-write serialization).
  - `lib/execution.ts`: 0% → **96.72%**.
  - `lib/keyring.ts`: 0% → **93.87%** (incl. Linux no-libsecret simulation).
  - Validator Layer 2/3: 16 new tests covering each E020–E030, E040.
- `src/lib/stdin.ts` — shared kubectl-style `readJsonSource()` helper.
- `src/lib/workflow-body.ts` — added `suggestTimeout(bytes)` for large
  payload auto-extension (future wiring).
- `@vitest/coverage-v8` + `axios-mock-adapter` added as devDeps.

## [0.1.1] — 2026-04-23

### Fixed

#### `@trngthnh369/n8nctl`

- **`--no-keyring` flag now actually works.** Commander maps `--no-keyring` to `{ keyring: false }`,
  not `{ noKeyring: true }`. Previous code checked `opts.noKeyring` (always `undefined`), so the flag
  was silently ignored and credentials were always written to keyring regardless of user intent.
  (Bug verified reproducible; regression test added.)
- **Keyring verify-after-write.** `setPassword` now round-trips with `getPassword` before returning
  success. On Linux hosts without `libsecret-1` (headless servers, Docker containers), keytar could
  previously report success but fail to persist; now the round-trip check forces fallback to
  plaintext config with a clear warning.
- **`workflow create` / `workflow update` now strip read-only fields consistently** with
  `workflow restore` / `workflow import`. Fields stripped: `id`, `createdAt`, `updatedAt`,
  `versionId`, `active`, `tags`. Consolidated into `src/lib/workflow-body.ts`.
- **`workflow trigger-webhook` warns when multiple webhook nodes exist** and `--path` was not
  specified. Previously it silently picked the first node, which could mean firing the wrong
  webhook. Now it emits a `warning:` to stderr and suggests `--path <path>` to disambiguate.
- **Bumped `axios` from `^1.7.7` to `^1.7.9`** — addresses CVE-2024-57965 (memory allocation DOS).

#### `@trngthnh369/n8n-workflow-validator`

- **Null-guard for `nodes[i]`.** Previously a workflow with `nodes: [null]` or nodes containing
  non-object values (string, number, nested array) would throw `TypeError: Cannot read properties
  of null (reading 'id')` instead of reporting a validation error. New error code `E009`.

### Added

- `workflow create` now supports `--dry-run` (parity with `update`, `delete`, `tag`, `restore`,
  `import`).

### Internal

- `src/lib/workflow-body.ts` — shared `stripReadOnlyFields()` helper (DRY).
- Regression test suites (`tests/regression.test.ts` in both packages) pin each bug with a failing
  test that would fail if the fix is reverted.
- 31 tests total now pass (was 22).

## [0.1.0] — 2026-04-23

Initial public release.

- 28+ leaf commands across 7 noun groups (workflow, execution, credential, tag, auth, config,
  profile) + top-level `doctor`.
- Layered auth: `--api-key` flag → `N8N_API_KEY` env → OS keyring (keytar) → config file.
- Multi-instance profiles (dev/staging/prod) with one-shot `--profile <name>` override.
- Universal output trio: `--json` / `--jq <expr>` / `--template <handlebars>`.
- TTY-aware: pretty table in terminal, JSON when piped.
- Typed exit codes (0 OK / 1 API / 2 auth / 3 validation / 4 network / 5 internal).
- Retry + exponential backoff with `Retry-After` header support.
- Offline workflow validation via `@trngthnh369/n8n-workflow-validator` (6 layers).
- Atomic config writes via `proper-lockfile`.
- `--dry-run` for destructive operations.
- `--insecure` flag + per-profile `insecure: true` for self-signed TLS.
