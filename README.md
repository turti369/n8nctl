# n8nctl monorepo

> 🇻🇳 **[Đọc bằng tiếng Việt](./README.vi.md)**

Workspace containing two npm packages for operating n8n instances from the command line:

| Package | Purpose | npm |
|---------|---------|-----|
| [`@trngthnh369/n8nctl`](./packages/n8nctl) | CLI for managing n8n workflows via REST API | [![npm](https://img.shields.io/npm/v/@trngthnh369/n8nctl.svg)](https://www.npmjs.com/package/@trngthnh369/n8nctl) |
| [`@trngthnh369/n8n-workflow-validator`](./packages/n8n-workflow-validator) | Offline n8n workflow JSON validator (6-layer checks) | [![npm](https://img.shields.io/npm/v/@trngthnh369/n8n-workflow-validator.svg)](https://www.npmjs.com/package/@trngthnh369/n8n-workflow-validator) |

## Install

```bash
# CLI (includes the validator as a dependency)
npm install -g @trngthnh369/n8nctl

# Validator only — for use in Node.js automation code
npm install @trngthnh369/n8n-workflow-validator
```

## Quick start

```bash
n8nctl auth login
n8nctl workflow list
n8nctl workflow validate ./my-workflow.json
n8nctl workflow backup 42 -o ./backups/
```

## Development

```bash
git clone https://github.com/trngthnh369/n8nctl.git
cd n8nctl
npm install                         # installs workspace deps
npm run build                       # builds all packages
npm test                            # runs all package tests

# Link CLI for local testing
cd packages/n8nctl && npm link
n8nctl --help
```

## Packages

### `@trngthnh369/n8nctl`
Full CLI inspired by `gh` and `kubectl`. Layered auth, multi-instance profiles,
`--json` / `--jq` / `--template` output. See [package README](./packages/n8nctl/README.md).

### `@trngthnh369/n8n-workflow-validator`
Standalone validator used by the CLI. 6 layers: structural, referential, expression, secrets, node sanity, parameter types.
See [package README](./packages/n8n-workflow-validator/README.md).

## Claude Code skills (optional)

If you use [Claude Code](https://claude.com/claude-code), the [`skills/`](./skills) directory contains 10 paired skills (n8nctl CLI reference, pipeline orchestrator, node configuration catalog, validation expert, integration recipes for Meta/Sheets/TikTok/Claude API, JS/Python code node helpers, workflow patterns). Install with one command:

```bash
./skills/install.sh            # Unix / macOS / Git Bash
.\skills\install.ps1           # Windows PowerShell
```

Read [`skills/README.md`](./skills/README.md) for details. Skip this section if you only need the CLI.

## License

MIT
