# @trngthnh369/n8nctl

> kubectl for n8n. A friendly CLI for managing n8n workflows via REST API — inspired by `gh`, `kubectl`, and `gws`.

[![npm version](https://img.shields.io/npm/v/@trngthnh369/n8nctl.svg)](https://www.npmjs.com/package/@trngthnh369/n8nctl)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

## Features

- Full workflow CRUD (`list`, `get`, `create`, `update`, `activate`, `backup`, `execute`, `delete`)
- Execution inspection (`execution list/get/retry`) with logs
- Layered auth: `--api-key` → `$N8N_API_KEY` → OS keyring (keytar) → config file
- **Multi-instance profiles** (dev/staging/prod) — switch with one command
- Universal `--json` / `--jq` / `--template` output trio (gh-style)
- TTY-aware: pretty table in terminal, JSON when piped
- Typed exit codes (0 OK, 1 API, 2 auth, 3 validation, 4 network, 5 internal)
- Retry with exponential backoff + `Retry-After` respect
- Offline workflow validation via [`@trngthnh369/n8n-workflow-validator`](../n8n-workflow-validator)

## Install

```bash
npm install -g @trngthnh369/n8nctl
```

Requires Node.js 20+.

## Quick start

```bash
# 1. One-time auth setup (stores key in OS keyring)
n8nctl auth login

# 2. List workflows
n8nctl workflow list

# 3. Back up a workflow
n8nctl workflow backup 42 -o ./backups/

# 4. Deploy from file (with offline validation)
n8nctl workflow validate ./my-workflow.json
n8nctl workflow create ./my-workflow.json
n8nctl workflow activate 58

# 5. Trigger execution
n8nctl workflow execute 58 --data '{"input": "value"}'

# 6. Inspect last execution
n8nctl execution list --workflow 58 --limit 1
n8nctl execution get <execution-id> --logs
```

## Command reference

See [the umbrella README](../../README.md) for the full monorepo context.

### workflow
| Command | Description |
|---------|-------------|
| `workflow list [--active] [--tag <t>]` | List workflows |
| `workflow get <id> [-o <file>]` | Fetch workflow JSON |
| `workflow create <file>` | Create from JSON file |
| `workflow update <id> <file>` | Update from JSON file |
| `workflow activate <id>` | Activate workflow |
| `workflow deactivate <id>` | Deactivate workflow |
| `workflow execute <id> [--data <json>]` | Trigger execution |
| `workflow backup <id> [-o <dir>]` | Backup to timestamped file |
| `workflow delete <id> [--yes]` | Delete workflow |
| `workflow validate <file> [--strict]` | Offline 6-layer validation |

### execution
| Command | Description |
|---------|-------------|
| `execution list [--workflow <id>] [--limit <n>]` | List executions |
| `execution get <id> [--logs]` | Get execution details |
| `execution retry <id>` | Retry failed execution |

### credential
| Command | Description |
|---------|-------------|
| `credential list` | List credentials (no values) |

### auth
| Command | Description |
|---------|-------------|
| `auth login [--host <url>] [--no-keyring]` | Interactive auth setup |
| `auth status` | Show active auth + connectivity test |
| `auth logout [--profile <name>]` | Remove stored credentials |

### config
| Command | Description |
|---------|-------------|
| `config get <key>` | Get config value |
| `config set <key> <value>` | Set config value |
| `config list` | Show all config |

### profile
| Command | Description |
|---------|-------------|
| `profile list` | List profiles |
| `profile add <name> --host <url>` | Add profile |
| `profile switch <name>` | Set active profile |
| `profile remove <name>` | Remove profile |

## Auth resolution order

1. `--api-key <token>` flag (ephemeral, for CI)
2. `$N8N_API_KEY` + `$N8N_HOST` env vars (legacy compat)
3. OS keyring via `keytar` (default for interactive installs)
4. `~/.config/n8nctl/config.yml` / `%APPDATA%\n8nctl\config.yml` (plaintext fallback, warned)

## Multi-instance profiles

```bash
n8nctl profile add prod --host https://n8n-prod.example.com
n8nctl profile add dev  --host https://n8n-dev.example.com
n8nctl auth login --profile prod
n8nctl auth login --profile dev
n8nctl profile switch prod
n8nctl workflow list              # hits prod
n8nctl --profile dev workflow list # one-shot override
```

## Output format trio

```bash
n8nctl workflow list                              # TTY: pretty table
n8nctl workflow list | cat                        # piped: JSON
n8nctl workflow list --json                       # force JSON
n8nctl workflow list --jq '.[] | select(.active)' # jq query
n8nctl workflow list --template '{{#each this}}{{id}}  {{name}}{{newline}}{{/each}}'
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | API error (4xx/5xx from n8n) |
| 2 | Auth error |
| 3 | Validation error |
| 4 | Network error |
| 5 | Internal error |

## Self-signed TLS

For development instances with self-signed certificates, either set:

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

or (coming in v0.2) use `--insecure` flag / per-profile `insecure: true`.

## License

MIT
