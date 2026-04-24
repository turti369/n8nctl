---
name: n8n-validation-expert
description: Interpret validation errors and guide fixing them. Use when encountering validation errors, validation warnings, false positives, operator structure issues, or need help understanding validation results. Also use when asking about validation profiles, error types, or the validation loop process.
---

# n8n Validation Expert

> **⚠️ IMPORTANT (2026-04-21):** `n8n-mcp` not installed. `validate_node`/`n8n_create_workflow`/`n8n_update_partial_workflow` refs are **LEGACY**. Use `node D:/Projects/work/build-workflow/_pipeline/validate.js <file>` (local 6-layer validator with type checking) + `n8nctl` CLI for CRUD.

## Validation Philosophy

**Iterative, not one-shot.** Expect 2-3 validate → fix cycles. Read errors carefully, don't fix what you don't understand.

## Severity Levels

| Level | Blocks? | Types |
|-------|---------|-------|
| **Error** | ✅ YES — must fix | `missing_required`, `invalid_value`, `type_mismatch`, `invalid_reference`, `invalid_expression` |
| **Warning** | ❌ No (but should fix) | `best_practice`, `deprecated`, `performance` |
| **Suggestion** | ❌ No (optional) | `optimization`, `alternative` |

## Validation Loop

```
Configure node → validate.js → Read errors → Fix → validate.js → (repeat)
                                  ↑                                     │
                                  └─────────────────────────────────────┘
                                  Usually 2-3 iterations to valid
```

## Validation Profiles

| Profile | Use when | Checks |
|---------|----------|--------|
| `minimal` | Quick check during editing | Required fields, basic structure |
| `runtime` (default) | Before deploy | All errors + common warnings |
| `strict` | Production readiness | All errors + all warnings + best practices |
| `ai-friendly` | When using AI tools | Extra checks for AI-generated configs |

## Top Error Categories

### 1. `missing_required`
Required field missing. Fix: provide the field with valid value.
```
Error: "channel" is required for slack.post
Fix: Add "channel": "#general"
```

### 2. `type_mismatch` (most common in ECC)
Wrong data type. Often: string instead of object, string instead of boolean/number.
```
Error: "headerParameters" must be object, got string
Fix: Use { parameters: [{name: "X", value: "Y"}] } format
```
→ See `n8n-node-configuration` inline catalog for types.

### 3. `invalid_value`
Value doesn't match allowed enum.
```
Error: "method": "Get" not in [GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS]
Fix: Uppercase → "GET"
```

### 4. `invalid_expression`
Expression syntax broken (unbalanced braces, wrong `$json` access).
```
Error: Unbalanced {{ }} in "url"
Fix: Count `{{` must match `}}`
```
→ See `n8n-expression-syntax` skill.

### 5. `invalid_reference`
Referenced node doesn't exist (typo in `$node["..."]`, deleted upstream node).
Fix: Check node name exactly matches upstream node's display name.

## False Positives (ignore these)

Auto-sanitization fixes some issues on save. Don't manually fix:

- **IF/Switch `singleValue` missing** — Auto-added when using unary operator
- **Operator structure metadata** — Added on workflow save
- **typeVersion inferred** — Some nodes accept missing typeVersion

→ See [FALSE_POSITIVES.md](FALSE_POSITIVES.md) for complete list.

## Detailed References

- **[ERROR_CATALOG.md](ERROR_CATALOG.md)** — Full error code catalog với fix suggestions
- **[FALSE_POSITIVES.md](FALSE_POSITIVES.md)** — Known false-positive errors (ignore safely)

## 6-Layer Local Validator (`_pipeline/validate.js`)

Layer reference (cho ECC setup của user):

| Layer | Checks |
|-------|--------|
| 1 | JSON parse |
| 2 | Top-level structure (nodes, connections, settings) |
| 3 | Expression brace balance `{{ }}` |
| 4 | Node reference validity ($node["Name"]) |
| 5 | Connection integrity (source/target exist) |
| 6 | Node type + required params + param types (uses node-catalog.json) |

Run: `node D:/Projects/work/build-workflow/_pipeline/validate.js <workflow.json>`

## Workflow with Errors

Fix priority:
1. **CRITICAL errors first** (syntax, type) — block execution
2. **Reference errors** — cascade failures
3. **Required field errors** — after structure valid
4. **Warnings** — iterate during refinement

Don't fix all warnings upfront; address them when they block further progress.

## Related Skills

- **`n8n-node-configuration`** — Type catalog for Layer 6 errors
- **`n8n-expression-syntax`** — Fix `invalid_expression` errors
- **`n8nctl`** — Deploy validated workflows
- **`n8n-fix`** command — Self-healing loop calling validate + fix + retry
