# n8nctl Claude Code skills

Optional bundle of [Claude Code](https://claude.com/claude-code) skills that pair with the `n8nctl` CLI. Install these skills to teach Claude Code how to build, deploy, debug, test, and rollback n8n workflows on your instance.

**These are only useful if you use Claude Code.** If you just want the CLI, stop here — `npm install -g @trngthnh369/n8nctl` is all you need.

## What's in this bundle

| Skill | Purpose |
|-------|---------|
| [`n8nctl`](./n8nctl) | CLI command reference + raw REST fallback |
| [`n8n-pipeline`](./n8n-pipeline) | Top-level orchestrator routing build/deploy/test/fix/rollback |
| [`n8n-patterns`](./n8n-patterns) | Workflow patterns, node cheat sheet, ecommerce examples |
| [`n8n-node-configuration`](./n8n-node-configuration) | Per-node required/optional fields + offline typeVersion catalog |
| [`n8n-expression-syntax`](./n8n-expression-syntax) | Common n8n `{{ }}` mistakes + fixes |
| [`n8n-validation-expert`](./n8n-validation-expert) | Interpret validator errors E001–E066 |
| [`n8n-integrations`](./n8n-integrations) | Meta/Facebook, Google Sheets, TikTok, Claude API recipes |
| [`n8n-code-javascript`](./n8n-code-javascript) | JavaScript in Code nodes (`$input`, `$helpers`, `DateTime`) |
| [`n8n-code-python`](./n8n-code-python) | Python in Code nodes (`_input`, `_json`, stdlib limits) |
| [`n8n-workflow-patterns`](./n8n-workflow-patterns) | Architectural patterns for webhook / HTTP / DB / AI / schedule |

## Install

### Unix / macOS / Git Bash

```bash
git clone https://github.com/trngthnh369/n8nctl.git
cd n8nctl/skills
./install.sh
```

### Windows PowerShell

```powershell
git clone https://github.com/trngthnh369/n8nctl.git
cd n8nctl\skills
.\install.ps1
```

Both installers copy each `<skill>/SKILL.md` to `~/.claude/skills/<skill>/SKILL.md`. Claude Code loads the new skills on the next session.

## Install a single skill

```bash
./install.sh n8n-integrations
# or
.\install.ps1 -Name n8n-integrations
```

## Overwrite without prompting

```bash
FORCE=1 ./install.sh
# or
.\install.ps1 -Force
```

## Target a different directory

```bash
CLAUDE_SKILLS_DIR=/path/to/custom/skills ./install.sh
# or
$env:CLAUDE_SKILLS_DIR = "C:\custom\skills"; .\install.ps1
```

## Verify install

Open a new Claude Code session and ask:

> liệt kê các active workflow

Claude should load the `n8nctl` skill and reply using `n8nctl workflow list`.

## Customize after install

The files in `~/.claude/skills/` are yours — edit them freely. Some skills contain examples tied to the author's workspace (paths like `D:/Projects/work/build-workflow/`, project names like `ai-ads-manager`). Those are illustrative; adjust to your own environment:

```bash
# Example: replace author's workspace path with yours
cd ~/.claude/skills
grep -rl "D:/Projects/work/build-workflow" . | xargs sed -i 's|D:/Projects/work/build-workflow|/your/path|g'
```

The `n8n-pipeline` skill specifically assumes a directory layout documented inside the skill. If you organize your n8n projects differently, read the skill top-to-bottom once and adapt the paths + project names.

## Required env vars

The CLI (and therefore every skill that calls it) needs:

```bash
export N8N_HOST="https://your-n8n-instance.example.com"
export N8N_API_KEY="n8n_api_..."
```

Or run `n8nctl auth login` once to store credentials in the OS keyring.

## Uninstall

```bash
rm -rf ~/.claude/skills/n8n{ctl,-pipeline,-patterns,-node-configuration,-expression-syntax,-validation-expert,-integrations,-code-javascript,-code-python,-workflow-patterns}
```

## License

MIT — same as the parent repository.

## Contributing

- Skills are Markdown with YAML frontmatter (`name`, `description`, optional `allowed-tools`)
- Keep each skill under ~300 lines; split if it grows bigger
- Real-world examples > abstract theory
- PRs welcome: https://github.com/trngthnh369/n8nctl/pulls
