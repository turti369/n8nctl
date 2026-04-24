---
name: n8n-node-configuration
description: Operation-aware node configuration for n8n workflows. Use when configuring nodes, determining required fields, verifying parameter types, or learning common configuration patterns by node type. Contains offline catalog for top 20 native nodes so you do NOT need n8n-mcp MCP server.
---

# n8n Node Configuration

> **⚠️ IMPORTANT (2026-04-21):** `n8n-mcp` server is NOT installed. Legacy `get_node`/`search_nodes`/`validate_node` references in `references/` are FYI only. Use **inline catalog** below + `D:/Projects/work/build-workflow/_pipeline/node-catalog.json` + `node D:/Projects/work/build-workflow/_pipeline/validate.js` (Layer 6 checks types).

## Core Principles

1. **Operation-aware**: Resource + operation determine required fields. Slack `post` ≠ `update` ≠ `create channel` requirements.
2. **Progressive discovery**: Start minimal (standard detail), add complexity only when validation fails.
3. **Dependency-aware**: `displayOptions.show` controls visibility. Field "missing"? → check parent field values.

## Configuration Workflow

```
Identify node + operation → Get standard detail → Configure required
    ↓
Validate (validate.js Layer 6) → Fix issues → Re-validate → Deploy
```

Average 2-3 iterations to valid config. Read validation errors carefully.

## Top Anti-Patterns

1. ❌ **Over-configure upfront** — Adding all 20 optional fields on first pass. Start minimal.
2. ❌ **Skip validation** — `n8n_update_partial_workflow` without validate first. YOLO.
3. ❌ **Copy config across operations** — Slack `post` config won't work for `update` (different required fields).
4. ❌ **String vs object confusion** — `headerParameters`, `assignments`, `conditions` are OBJECTS with `.parameters` array, not strings.
5. ❌ **Boolean vs string** — `sendHeaders: "yes"` is wrong; must be `sendHeaders: true`.
6. ❌ **Number vs string** — `batchSize: "10"` wrong; must be `batchSize: 10`.
7. ❌ **Manually fix auto-sanitization** — IF/Switch operator structure auto-fixed on save. Don't add `singleValue` manually.

## Detailed References

- **[OPERATION_PATTERNS.md](OPERATION_PATTERNS.md)** — Per-node patterns: HTTP, Slack, Google Sheets, IF, Database, Webhook. Examples cho từng operation.
- **[DEPENDENCIES.md](DEPENDENCIES.md)** — `displayOptions.show/hide` mechanism, property dependency patterns, how to find what triggers visibility.

---

## OFFLINE NODE CATALOG (top 20 native nodes)

**Source of truth:** `D:/Projects/work/build-workflow/_pipeline/node-catalog.json` — used by `validate.js` Layer 6. This mirrors that catalog so Claude can build workflows without MCP.

| Node type | typeVersion | Required params (type) | Key enums |
|-----------|-------------|------------------------|-----------|
| `n8n-nodes-base.httpRequest` | 4.2 | `method` (string), `url` (string) | method: GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS |
| `n8n-nodes-base.code` | 2 | `jsCode` (string) or `pythonCode` when language=python | mode: runOnceForAllItems/runOnceForEachItem; language: javaScript/python |
| `n8n-nodes-base.set` | 3.4 | `assignments` (object) | mode: manual/raw |
| `n8n-nodes-base.if` | 2.2 | `conditions` (object) | combinator: and/or |
| `n8n-nodes-base.switch` | 3.2 | `rules` (object) | mode: rules/expression |
| `n8n-nodes-base.merge` | 3.1 | `mode` (string) | mode: append/combine/chooseBranch |
| `n8n-nodes-base.splitInBatches` | 3 | `batchSize` (number) | — |
| `n8n-nodes-base.webhook` | 2 | `path` (string), `httpMethod` (string) | httpMethod: GET/POST/...; responseMode: onReceived/lastNode/responseNode |
| `n8n-nodes-base.scheduleTrigger` | 1.2 | `rule` (object) | — |
| `n8n-nodes-base.manualTrigger` | 1 | (none) | — |
| `n8n-nodes-base.executeWorkflow` | 1.2 | `workflowId` (any) | mode: each/once; source: database/localFile/parameter/url |
| `n8n-nodes-base.executeWorkflowTrigger` | 1.1 | (none) | — |
| `n8n-nodes-base.respondToWebhook` | 1.1 | `respondWith` (string) | respondWith: text/json/firstIncomingItem/allIncomingItems/binary/redirect/noData |
| `n8n-nodes-base.wait` | 1.1 | `resume` (string) | resume: timeInterval/specificTime/webhook; unit: seconds/minutes/hours/days |
| `n8n-nodes-base.filter` | 2.2 | `conditions` (object) | — |
| `n8n-nodes-base.aggregate` | 1 | `aggregate` (string) | aggregate: aggregateIndividualFields/aggregateAllItemData |
| `n8n-nodes-base.googleSheets` | 4.4 | `resource` (string), `operation` (string) | resource: sheet/spreadsheet; operation: append/appendOrUpdate/clear/delete/read/update |
| `n8n-nodes-base.gmail` | 2.1 | `resource` (string), `operation` (string) | resource: message/label/draft/thread; operation: send/reply/get/getAll |
| `n8n-nodes-base.slack` | 2.3 | `resource` (string), `operation` (string) | resource: channel/file/message/reaction/star/user |
| `@n8n/n8n-nodes-langchain.openAi` | 1.6 | `resource` (string), `operation` (string) | resource: assistant/text/image/audio/file |
| `@n8n/n8n-nodes-langchain.lmChatAnthropic` | 1.2 | `model` (object) | — |

### Common type mistakes (caught by Layer 6)

**Object-typed fields** (NOT strings/arrays). Format:
```json
"headerParameters": {
  "parameters": [
    { "name": "Content-Type", "value": "application/json" }
  ]
}
```
Fields: `headerParameters`, `queryParameters`, `bodyParameters`, `assignments`, `conditions`, `rules`.

**Boolean-typed**: `sendHeaders`, `sendQuery`, `sendBody`, `includeOtherFields` → `true`/`false`, not `"yes"`.

**Number-typed**: `batchSize`, `responseCode`, `amount` → number literals.

**Enum violations**: `method` must be uppercase (GET/POST/...), not `"Get"` or `"GETT"`.

**typeVersion**: numeric literal `4.2`, not string `"4.2"`.

### Expression fields (`={{...}}`) skip type check

Values starting with `=` are runtime expressions. Layer 6 skips type check; expression brace balance checked by Layer 3.
```json
"url": "=https://graph.facebook.com/v19.0/{{ $json.page_id }}/feed"
```

---

## Related Skills

- **`n8nctl`** — CLI + REST API for live workflow CRUD (replaces n8n-mcp discovery)
- **`n8n-validation-expert`** — Interpret errors from `_pipeline/validate.js`
- **`n8n-expression-syntax`** — Configure `={{...}}` expression fields
- **`n8n-workflow-patterns`** — Architectural patterns (webhook, scheduled, AI agent, etc.)
