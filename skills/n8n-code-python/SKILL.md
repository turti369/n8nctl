---
name: n8n-code-python
description: Write Python code in n8n Code nodes. Use when writing Python in n8n, using _input/_json/_node syntax, working with standard library, or need to understand Python limitations in n8n Code nodes.
---

# Python Code Node (Beta)

> **⚠️ IMPORTANT (2026-04-21):** `search_nodes`/`get_node`/`validate_node`/`n8n_create_workflow` in references are **LEGACY** — `n8n-mcp` not installed. Use `n8nctl` CLI + `node D:/Projects/work/build-workflow/_pipeline/validate.js <file>` for validation.

## JavaScript First

**Recommendation**: JavaScript cho 95% use case. Chỉ dùng Python khi:
- Cần specific stdlib functions (statistics, specific regex, etc.)
- Comfort zone với Python syntax hơn hẳn
- Data transformation map tốt vào list comprehensions

JS có **`$helpers.httpRequest`**, **Luxon DateTime**, better n8n integration — Python thì không.

## Essential Rules

1. **Return format**: PHẢI là `[{"json": {...}}]` — list of dicts với `"json"` key. Không phải dict, không phải plain list.
2. **Data access**: `_input.all()` (array), `_input.first()` (single), `_input.item` (each-item mode only)
3. **Webhook data**: Nested dưới `_json["body"]` — KHÔNG phải `_json[field]` trực tiếp
4. **NO external libs**: Không `requests`/`pandas`/`numpy`/`BeautifulSoup`. Workaround: HTTP Request node trước Code node.
5. **Stdlib only**: `json`, `datetime`, `re`, `base64`, `hashlib`, `urllib.parse`, `math`, `random`, `statistics`
6. **Safe access**: `.get("field", default)` để tránh KeyError
7. **Mode choice**: "Run Once for All Items" (default, 95% case) vs "Run Once for Each Item" (independent per-item logic)

## Template

```python
items = _input.all()

processed = []
for item in items:
    processed.append({
        "json": {
            **item["json"],
            "processed": True,
            "timestamp": datetime.now().isoformat()
        }
    })

return processed
```

## Top 5 Errors (avoid these)

### #1 Import external library
```python
# ❌ ModuleNotFoundError
import requests

# ✅ Use HTTP Request node before, OR switch to JavaScript + $helpers.httpRequest
```

### #2 Missing / wrong return
```python
# ❌ Dict (not list)
return {"json": data}

# ✅ List wrapper required
return [{"json": data}]
```

### #3 Webhook field access
```python
# ❌ KeyError — webhook data is nested
email = _json["email"]

# ✅ Under ["body"]
email = _json.get("body", {}).get("email")
```

### #4 KeyError on dict
```python
# ❌ Crashes if missing
name = _json["user"]["name"]

# ✅ .get() with defaults
name = _json.get("user", {}).get("name", "Unknown")
```

### #5 Inconsistent return structure
```python
# ❌ Some paths return list, some return dict
if valid:
    return [{"json": data}]
else:
    return {"error": "..."}  # Dict!

# ✅ All paths return same shape
if valid:
    return [{"json": data}]
else:
    return [{"json": {"error": "..."}}]
```

## Python Modes

- **Python (Beta)** — RECOMMENDED. Uses `_input`, `_json`, `_node`, `_now`, `_today`, `_jmespath()`.
- **Python (Native)** — Only `_items`, `_item`. No helpers. Use only when pure Python needed.

## Pre-deploy checklist

- [ ] Considered JavaScript first
- [ ] Return `[{"json": {...}}]` format
- [ ] `_input.all()` / `_input.first()` / `_input.item` used correctly per mode
- [ ] No external imports
- [ ] `.get()` for safe dict access
- [ ] Webhook data under `["body"]`
- [ ] All code paths return same shape

## Detailed References

- **[DATA_ACCESS.md](DATA_ACCESS.md)** — All data access patterns, webhook structure, node reference
- **[COMMON_PATTERNS.md](COMMON_PATTERNS.md)** — 10 production Python patterns (transform, filter, regex, validate, stats)
- **[ERROR_PATTERNS.md](ERROR_PATTERNS.md)** — Full error catalog với fixes
- **[STANDARD_LIBRARY.md](STANDARD_LIBRARY.md)** — Complete stdlib reference cho n8n Python context

## Related Skills

- **`n8n-code-javascript`** — JS version (preferred for 95% cases)
- **`n8n-expression-syntax`** — `{{ }}` in other nodes (Code nodes không dùng `{{ }}`)
- **`n8n-node-configuration`** — Code node config (mode, language selector)
- **`n8n-validation-expert`** — Interpret validation errors

## External docs

- Code Node: https://docs.n8n.io/code/code-node/
- Python in n8n: https://docs.n8n.io/code/builtin/python-modules/
