---
name: n8n-code-javascript
description: Write JavaScript code in n8n Code nodes. Use when writing JavaScript in n8n, using $input/$json/$node syntax, making HTTP requests with $helpers, working with dates using DateTime, troubleshooting Code node errors, or choosing between Code node modes.
---

# JavaScript Code Node

> **⚠️ IMPORTANT (2026-04-21):** `search_nodes`/`get_node`/`validate_node`/`n8n_create_workflow` in references are **LEGACY** — `n8n-mcp` not installed. Use `n8nctl` CLI + `node D:/Projects/work/build-workflow/_pipeline/validate.js <file>` for validation.

JavaScript là **recommended choice** cho 95% use cases (vs Python) — vì có `$helpers.httpRequest()`, Luxon DateTime, và tích hợp n8n tốt hơn.

## Essential Rules

1. **Return format**: PHẢI là `[{ json: {...} }]` — array of objects với `json` key
2. **Data access**: `$input.all()` (array), `$input.first()` (single), `$input.item` (each-item mode only)
3. **Webhook data**: Nested dưới `$json.body` — KHÔNG phải `$json[field]` trực tiếp
4. **Built-ins**: `$helpers.httpRequest()`, `DateTime` (Luxon), `$jmespath()`, `$node["Name"]`
5. **Safe access**: Dùng optional chaining `?.` và nullish coalescing `??`
6. **Mode choice**: "Run Once for All Items" (default, 95% case) vs "Run Once for Each Item"

## Template

```javascript
const items = $input.all();

const processed = items.map(item => ({
  json: {
    ...item.json,
    processed: true,
    timestamp: new Date().toISOString()
  }
}));

return processed;
```

## Top 5 Errors (avoid these)

### #1 Wrong return format
```javascript
// ❌ Object (not array)
return { json: data };

// ❌ Array without json wrapper
return [data];

// ✅ Array of { json: ... }
return [{ json: data }];
```

### #2 Webhook field access
```javascript
// ❌ undefined — webhook data is nested
const email = $json.email;

// ✅ Under .body
const email = $json.body?.email;
```

### #3 Missing await for httpRequest
```javascript
// ❌ Returns Promise object, not data
const res = $helpers.httpRequest({ url: '...' });

// ✅ await (code runs in async context by default)
const res = await $helpers.httpRequest({ url: '...' });
```

### #4 Mutating input items
```javascript
// ❌ Mutates shared reference — can break downstream
const items = $input.all();
items[0].json.processed = true;
return items;

// ✅ Create new objects
return $input.all().map(item => ({
  json: { ...item.json, processed: true }
}));
```

### #5 Wrong mode data access
```javascript
// ❌ "Each Item" mode — $input.all() works but inefficient
const items = $input.all();

// ✅ Each Item mode uses $input.item
const item = $input.item;
```

## Key Built-ins

### HTTP requests
```javascript
const res = await $helpers.httpRequest({
  method: 'POST',
  url: 'https://api.example.com/x',
  body: { key: 'value' },
  json: true,
  headers: { Authorization: 'Bearer ...' }
});
```

### DateTime (Luxon)
```javascript
const now = DateTime.now();
const iso = now.toISO();
const plusDays = now.plus({ days: 7 });
const formatted = now.toFormat('yyyy-MM-dd HH:mm');
const tz = DateTime.now().setZone('Asia/Ho_Chi_Minh');
```

### JMESPath queries
```javascript
const names = $jmespath(data, 'users[*].name');
const active = $jmespath(data, "users[?status=='active']");
```

### Node references
```javascript
const webhookData = $node["Webhook"].json;
const httpData = $node["HTTP Request"].json;
```

## Pre-deploy checklist

- [ ] Return `[{ json: {...} }]` format
- [ ] `$input.all()` / `$input.first()` / `$input.item` matches mode
- [ ] Webhook data accessed via `.body`
- [ ] `await` before `$helpers.httpRequest()`
- [ ] No mutation of input items (spread `...item.json`)
- [ ] Safe access với `?.` và `??`

## Detailed References

- **[DATA_ACCESS.md](DATA_ACCESS.md)** — All data access patterns, webhook structure, multi-node refs
- **[COMMON_PATTERNS.md](COMMON_PATTERNS.md)** — 10 production JS patterns (transform, filter, HTTP, dedup, aggregate)
- **[BUILTIN_FUNCTIONS.md](BUILTIN_FUNCTIONS.md)** — Full `$helpers`, DateTime, `$jmespath` reference
- **[ERROR_PATTERNS.md](ERROR_PATTERNS.md)** — Error catalog với fixes

## Related Skills

- **`n8n-code-python`** — Python alternative (dùng khi cần stdlib specifically)
- **`n8n-expression-syntax`** — `{{ }}` in other nodes (Code nodes không dùng `{{ }}`)
- **`n8n-node-configuration`** — Code node config (mode, language selector)
- **`n8n-validation-expert`** — Interpret validation errors

## External docs

- Code Node: https://docs.n8n.io/code/code-node/
- JavaScript in n8n: https://docs.n8n.io/code/builtin/overview/
