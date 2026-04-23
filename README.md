# n8nctl

> A friendly CLI for managing n8n workflows via REST API — `kubectl` for n8n.

[![npm version](https://img.shields.io/npm/v/@trngthnh369/n8nctl.svg)](https://www.npmjs.com/package/@trngthnh369/n8nctl)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

`n8nctl` wraps the n8n REST API in an ergonomic command-line interface inspired by `gh`, `kubectl`, and `gws`. Ship workflows from git, script deployments, back up production, and manage multiple n8n instances from one shell.

## Features

- Full workflow CRUD (`list`, `get`, `create`, `update`, `activate`, `backup`, `execute`, `delete`)
- Execution inspection (`execution list/get/retry`) with logs
- Layered auth: `--api-key` → `$N8N_API_KEY` → OS keyring (keytar) → config file
- **Multi-instance profiles** (dev/staging/prod) — switch with one command
- Universal `--json` / `--jq` / `--template` output trio (gh-style)
- TTY-aware: pretty table in terminal, JSON when piped
- Typed exit codes (0 OK, 1 API, 2 auth, 3 validation, 4 network, 5 internal)
- Retry with exponential backoff + `Retry-After` respect

## Install

```bash
npm install -g @trngthnh369/n8nctl
```

Requires Node.js 20+.

## Quick start

```bash
# 1. One-time auth setup (stores key in OS keyring)
n8nctl auth login
# ? n8n host (URL): https://n8n.example.com
# ? API key: ******************

# 2. List workflows
n8nctl workflow list

# 3. Back up a workflow
n8nctl workflow backup 42 -o ./backups/

# 4. Deploy from file
n8nctl workflow create ./my-workflow.json
n8nctl workflow activate 58

# 5. Trigger execution
n8nctl workflow execute 58 --data '{"input": "value"}'

# 6. Inspect last execution
n8nctl execution list --workflow 58 --limit 1
n8nctl execution get <execution-id> --logs
```

## Auth resolution order

1. `--api-key <token>` flag (ephemeral, for CI)
2. `$N8N_API_KEY` + `$N8N_HOST` env vars (legacy compat)
3. OS keyring via `keytar` (default for interactive installs)
4. `~/.config/n8nctl/config.yml` (plaintext fallback, warned)

## Multi-instance profiles

```bash
n8nctl profile add prod --host https://n8n-prod.example.com
n8nctl profile add dev  --host https://n8n-dev.example.com
n8nctl profile switch prod
n8nctl workflow list         # hits prod
n8nctl --profile dev workflow list  # one-shot override
```

## Output format

```bash
n8nctl workflow list                              # TTY: pretty table
n8nctl workflow list | cat                        # piped: JSON
n8nctl workflow list --json                       # force JSON
n8nctl workflow list --jq '.[] | select(.active)' # jq query
n8nctl workflow list --template '{{#each .}}{{id}}  {{name}}{{newline}}{{/each}}'
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | API error (4xx/5xx from n8n) |
| 2 | Auth error (missing/invalid credentials) |
| 3 | Validation error (bad args, bad file) |
| 4 | Network error (timeout, DNS, connection refused) |
| 5 | Internal error (unexpected bug) |

## Command reference

### workflow
| Command | Description |
|---------|-------------|
| `n8nctl workflow list [--active] [--tag <tag>]` | List workflows |
| `n8nctl workflow get <id> [-o <file>]` | Fetch workflow JSON |
| `n8nctl workflow create <file>` | Create from JSON file |
| `n8nctl workflow update <id> <file>` | Update from JSON file |
| `n8nctl workflow activate <id>` | Activate workflow |
| `n8nctl workflow deactivate <id>` | Deactivate workflow |
| `n8nctl workflow execute <id> [--data <json>]` | Trigger execution |
| `n8nctl workflow backup <id> [-o <dir>]` | Backup to timestamped file |
| `n8nctl workflow delete <id> [--yes]` | Delete workflow |
| `n8nctl workflow validate <file>` | Validate JSON locally |

### execution
| Command | Description |
|---------|-------------|
| `n8nctl execution list [--workflow <id>] [--limit <n>]` | List executions |
| `n8nctl execution get <id> [--logs]` | Get execution details |
| `n8nctl execution retry <id>` | Retry failed execution |

### credential
| Command | Description |
|---------|-------------|
| `n8nctl credential list` | List credentials (no values) |

### auth
| Command | Description |
|---------|-------------|
| `n8nctl auth login [--host <url>]` | Interactive auth setup |
| `n8nctl auth status` | Show active auth + host |
| `n8nctl auth logout` | Remove stored credentials |

### config
| Command | Description |
|---------|-------------|
| `n8nctl config get <key>` | Get config value |
| `n8nctl config set <key> <value>` | Set config value |
| `n8nctl config list` | Show all config |

### profile
| Command | Description |
|---------|-------------|
| `n8nctl profile list` | List profiles |
| `n8nctl profile add <name> --host <url>` | Add profile |
| `n8nctl profile switch <name>` | Set active profile |
| `n8nctl profile remove <name>` | Remove profile |

## Development

```bash
git clone https://github.com/trngthnh369/n8nctl.git
cd n8nctl
npm install
npm run build
npm test

# Link for local testing
npm link
n8nctl --help
```

## Contributing

Issues and PRs welcome. Please use [conventional commits](https://www.conventionalcommits.org/) so `semantic-release` can cut releases automatically.

## License

MIT — see [LICENSE](./LICENSE).
