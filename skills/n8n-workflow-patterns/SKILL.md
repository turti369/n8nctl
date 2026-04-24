---
name: n8n-workflow-patterns
description: Proven workflow architectural patterns from real n8n workflows. Use when building new workflows, designing workflow structure, choosing workflow patterns, planning workflow architecture, or asking about webhook processing, HTTP API integration, database operations, AI agent workflows, or scheduled tasks.
---

# n8n Workflow Patterns

> **⚠️ IMPORTANT (2026-04-21):** `n8n-mcp` not installed. `search_nodes`/`get_node`/`search_templates` in refs are **LEGACY**. Use `n8nctl` CLI + inline catalog in `n8n-node-configuration` + `node D:/Projects/work/build-workflow/_pipeline/validate.js`. For templates, read existing JSONs in `D:/Projects/work/build-workflow/<project>/workflow/` or query `n8n-wiki` via `wiki-query`.

## 5 Core Patterns

| Pattern | Shape | Use case | Detailed ref |
|---------|-------|----------|--------------|
| **Webhook Processing** | Webhook → Validate → Transform → Respond | External events (Stripe, Slack, forms, GitHub) | [webhook_processing.md](webhook_processing.md) |
| **HTTP API Integration** | Trigger → HTTP Request → Transform → Action → Error Handler | Fetch REST APIs, data pipelines | [http_api_integration.md](http_api_integration.md) |
| **Database Operations** | Schedule → Query → Transform → Write → Verify | ETL, sync databases | [database_operations.md](database_operations.md) |
| **AI Agent Workflow** | Trigger → AI Agent (Model + Tools + Memory) → Output | Conversational AI, multi-step reasoning | [ai_agent_workflow.md](ai_agent_workflow.md) |
| **Scheduled Tasks** | Schedule → Fetch → Process → Deliver → Log | Periodic reports, maintenance | [scheduled_tasks.md](scheduled_tasks.md) |

## Pattern Selection (quick decision)

- **External event**? → Webhook Processing
- **Need data FROM external system**? → HTTP API Integration
- **CRUD a database periodically**? → Database Operations
- **LLM + tools/memory**? → AI Agent Workflow
- **Recurring time-based task**? → Scheduled Tasks

## Common Building Blocks

### Triggers
- **Webhook** — instant HTTP endpoint
- **Schedule** — cron-based
- **Manual** — testing
- **Polling** — check interval (avoid when webhook available)

### Data Sources
- **HTTP Request** — REST APIs
- **Database nodes** — Postgres, MySQL, MongoDB
- **Service nodes** — Slack, Google Sheets, Gmail
- **Code** — custom JS/Python logic

### Transformation
- **Set** — field map
- **Code** — complex logic
- **IF/Switch** — conditional routing
- **Merge** — combine streams
- **SplitInBatches** — iterate large arrays

### Outputs
- **HTTP Request** — call APIs
- **Database** — write data
- **Service nodes** — Slack post, Gmail send
- **Respond to Webhook** — HTTP response

## Error Handling (applies to all patterns)

Every production workflow needs:

1. **`onError` setting** on nodes that can fail (HTTP, DB, external API)
   - `stopWorkflow` (default) — full stop
   - `continueRegularOutput` — mask error, continue
   - `continueErrorOutput` — route to error branch

2. **Retry config** on transient-failure nodes (`retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 1000`)

3. **Error workflow** — separate workflow triggered by errorWorkflow setting. Logs + alerts.

4. **Idempotency** — operations safe to retry (upsert > insert, check before create)

## Naming Conventions

- Node names: **descriptive** ("Get User Profile" not "HTTP Request")
- Workflow names: `<domain>-<purpose>-v<N>` (e.g., `kpi-daily-sync-v2`)
- Tags: `<project>:<tier>` (e.g., `kpi-manager:hub`)
- Use Sticky Notes cho sections (Webhook → Validate → Process → Respond)

## Tier Architecture (ECC n8n convention)

User's setup trong `D:/Projects/work/build-workflow/` dùng 3-tier:

| Tier | Role | Example |
|------|------|---------|
| **Orchestrator** | Route events to hubs | Main webhook router |
| **Hub** | Domain logic, multiple operations | KPI Manager, AI Ads Manager |
| **Utility** | Single-purpose helpers | Post Facebook, Send Email |

Sub-workflows gọi qua `Execute Workflow` node.

## Template-First (MANDATORY)

Luôn start từ template:
- `D:/Projects/work/build-workflow/_templates/tier-orchestrator.json`
- `D:/Projects/work/build-workflow/_templates/tier-hub.json`
- `D:/Projects/work/build-workflow/_templates/tier-utility.json`

KHÔNG build from scratch — risk structural errors (settings, executionOrder, node IDs).

## Related Skills

- **`n8n-node-configuration`** — Per-node config + offline catalog
- **`n8n-expression-syntax`** — `{{ }}` expressions in node fields
- **`n8n-code-javascript`** / **`n8n-code-python`** — Code node content
- **`n8n-validation-expert`** — Validate patterns before deploy
- **`n8n-pipeline`** — Orchestrator skill cho build/deploy/test/fix/rollback
- **`n8nctl`** — CLI cho CRUD operations

## Commands (slash)

- `/n8n-build <desc> --tier=<T> --project=<name>` — Build new workflow from template
- `/n8n-deploy <file>` — Deploy với validate + backup + test gate
- `/n8n-test <wf>` — Execute + check Cần + Đủ gate
- `/n8n-fix <wf>` — Self-healing loop
- `/n8n-rollback <wf>` — Restore latest backup
