---
name: n8n-expression-syntax
description: Validate n8n expression syntax and fix common errors. Use when writing n8n expressions, using {{}} syntax, accessing $json/$node variables, troubleshooting expression errors, or working with webhook data in workflows.
---

# n8n Expression Syntax

> **⚠️ IMPORTANT (2026-04-21):** `n8n-mcp` not installed. For validation use `node D:/Projects/work/build-workflow/_pipeline/validate.js <file>` (Layer 3 checks expression brace balance).

## Format

Dynamic content **phải** dùng double curly braces: `{{expression}}`

```
✅ {{$json.email}}
✅ {{$json.body.name}}
❌ $json.email          (no braces — treated as literal)
❌ {$json.email}        (single braces — invalid)
❌ ={{$json.email}      (leading `=` is outside braces, OK — signals expression string)
```

**Field binding syntax** (URL/string fields): prefix with `=`:
```json
"url": "=https://api.com/v1/{{ $json.id }}"
"text": "=Hello {{ $json.body.name }}!"
```

## Core Variables

| Variable | Scope | Example |
|----------|-------|---------|
| `$json` | Current node input | `{{$json.user.email}}` |
| `$node["Name"]` | Specific node output | `{{$node["HTTP Request"].json.data}}` |
| `$now` | Current datetime (Luxon) | `{{$now.toFormat('yyyy-MM-dd')}}` |
| `$today` | Today midnight | `{{$today.toISO()}}` |
| `$env` | Environment variable | `{{$env.API_KEY}}` |
| `$workflow` | Workflow metadata | `{{$workflow.id}}`, `{{$workflow.name}}` |
| `$execution` | Execution metadata | `{{$execution.id}}` |
| `$itemIndex` | Current item index | `{{$itemIndex}}` |

## 🚨 Webhook Data Gotcha

**Most common mistake** — webhook data is **nested under `.body`**, not at root:

```js
// Webhook output structure:
{
  headers: {...},
  params: {...},
  query: {...},
  body: { name, email, message }  // ← user data here
}

❌ {{$json.email}}        // undefined
✅ {{$json.body.email}}   // correct
```

## Common Syntax

### Nested + array + bracket notation
```
{{$json.user.profile.email}}
{{$json.items[0].name}}
{{$json['field with spaces']}}
{{$json['user data']['first name']}}
```

### Node refs
```
{{$node["Set"].json.value}}
{{$node["HTTP Request"].json.data}}
{{$node["Webhook"].json.body.email}}  // webhook-specific
```
Node names: quoted, case-sensitive, exact match.

### Concat + conditional
```
{{$json.firstName}} {{$json.lastName}}
{{$json.status === 'active' ? 'Yes' : 'No'}}
{{$json.amount > 100 ? 'premium' : 'standard'}}
{{$json.email || 'no-email@example.com'}}
```

### DateTime (Luxon) in expressions
```
{{$now.toFormat('yyyy-MM-dd HH:mm:ss')}}
{{$now.plus({days: 7}).toISO()}}
{{$now.minus({hours: 1})}}
{{$now.setZone('Asia/Ho_Chi_Minh').toFormat('dd/MM/yyyy')}}
```

### JMESPath queries
```
{{$jmespath($json, 'users[*].email')}}
{{$jmespath($json, "items[?price>`100`].name")}}
```

### JSON helpers
```
{{JSON.stringify($json)}}
{{JSON.parse($json.jsonString).field}}
```

## Top 5 Errors

### #1 Unbalanced braces (Layer 3 catches this)
```
❌ {{$json.email}}}    // 3 closing
❌ {{$json.email}      // 1 closing
✅ {{$json.email}}     // matched
```

### #2 Missing `=` prefix for field binding
```json
❌ "url": "{{$json.endpoint}}"        // treated as literal string
✅ "url": "={{$json.endpoint}}"       // expression evaluated
✅ "url": "=https://api.com/{{$json.id}}/data"  // mixed
```

### #3 Webhook root access
```
❌ {{$json.email}}         // webhook data is nested
✅ {{$json.body.email}}
```

### #4 Unquoted / wrong node name
```
❌ {{$node[HTTP Request].json.x}}   // no quotes
❌ {{$node["http request"].json.x}} // case-sensitive mismatch
✅ {{$node["HTTP Request"].json.x}}
```

### #5 Wrong array/object access
```
❌ {{$json.items.0.name}}       // dot before number
✅ {{$json.items[0].name}}

❌ {{$json.field name}}         // space
✅ {{$json['field name']}}
```

## Detailed References

- **[EXAMPLES.md](EXAMPLES.md)** — 20+ real-world expression examples
- **[COMMON_MISTAKES.md](COMMON_MISTAKES.md)** — Full error catalog với detailed fixes

## Related Skills

- **`n8n-code-javascript`** / **`n8n-code-python`** — Code nodes don't use `{{ }}`
- **`n8n-validation-expert`** — Layer 3 brace-balance errors
- **`n8n-node-configuration`** — Which fields accept expressions
