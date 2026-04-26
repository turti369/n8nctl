# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
