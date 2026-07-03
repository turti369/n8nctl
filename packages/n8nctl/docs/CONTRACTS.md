# Stable contracts (frozen at 1.0.0)

These are the interfaces agents and CI scripts may depend on. From 1.0.0 they
follow semver: no breaking change without a major bump.

## 1. Exit codes

See `EXIT_CODES.md`. Frozen: `0` success · `1` ApiError · `2` AuthError ·
`3` ValidationError · `4` NetworkError · `5` InternalError · `6` AssertionFailed
(gate ran, expectation failed — `workflow verify`, `trigger-webhook
--expect-status`). Semantic-signal reuse of `1` (`workflow status --exit`,
`run --wait`, `execution wait`) is part of the contract.

## 2. Output selection

Every read command honors, in this precedence: `--json` → `--jq <expr>` →
`--template <handlebars>` → table (TTY) / JSON (non-TTY). Non-TTY always emits
JSON when no formatter is given. `--json` output shape per command is stable.

## 3. NDJSON event stream (`--log-format ndjson` / `N8NCTL_LOG_FORMAT=ndjson`)

One JSON object per line on **stderr**, never stdout. Every record has
`{ts, level, event, ...payload}`. Stable lifecycle events:
`http-request` · `http-response` · `http-retry` · `http-error` ·
`workflow-run-started` · `workflow-run-finished` · `verify-finished` ·
`workflow-rolled-back` · `workflow-promoted` · `source-control-pulled`.
New events may be ADDED; existing event names + their core payload keys are
frozen. Secrets never appear (execution IO is redacted; see §5).

## 4. Workflow write payload

`create` / `update` / `restore` / `import` / `rollback` / `promote` send ONLY
the 4-field whitelist `{name, nodes, connections, settings}`. Any other field
in a source file is dropped (n8n rejects extras with 400).

## 5. Redaction (default-on)

`execution logs --io-data`, `trigger-webhook --capture`, and
`workflow verify --capture` redact secret-named keys and secret-shaped values
by default. Raw output requires the explicit `--unsafe-raw-io` flag (which
warns). The promotion mapping report never prints secret values.

## 6. Global flag / profile precedence

A named `--profile` is self-contained: its host + key are used together. An
ambient `N8N_HOST` / `N8N_API_KEY` in the environment does NOT override the
chosen profile's host/key; only an explicit `--host` / `--api-key` on the CLI
does. (Without `--profile`, env `N8N_HOST`+`N8N_API_KEY` is the auth source.)

## 7. Subcommand flag naming

Where a subcommand needs an option whose name collides with a GLOBAL flag,
the subcommand uses a distinct name (commander resolves program options before
dispatch, so the global always wins): `validate --policy` (not `--profile`),
`scaffold --from` (not `--template`).

## 8. Destructive-op gates

`rollback`, `source-control pull`, `delete` require confirmation; non-TTY needs
`--yes` (they fail CLOSED otherwise). `--dry-run` previews every destructive op
with zero side effects (no snapshot, no write).

## 9. `node` verbs — live catalog (additive, 1.1.0)

`node list|describe|search` read `GET <host>/types/nodes.json` (the editor's
node catalog) via **session-cookie auth** — the api-key client 401s on that
path. The verbs are additive and their FLAGS are contract-stable; the catalog
CONTENT/shape is owned by the instance (varies with n8n version + installed
community nodes) and is explicitly NOT frozen. Output is cached 24h under the
config dir; `--refresh` forces a refetch.
