# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
