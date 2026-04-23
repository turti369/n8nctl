# @trngthnh369/n8n-workflow-validator

Offline validator for n8n workflow JSON. Used by [`@trngthnh369/n8nctl`](../n8nctl) CLI and importable as a library for automation scripts.

## 6 layers of checks

| Layer | What it catches | Codes |
|-------|----------------|-------|
| 1. Structural | Missing required top-level fields (`nodes`, `connections`, `name`) | E001–E004 |
| 2. Referential | Connections pointing to non-existent nodes, orphaned nodes | E020–E030 |
| 3. Expression | Unbalanced `{{ }}` in string values | E040 |
| 4. Secrets | Hardcoded Bearer tokens, JWTs, AWS/Google/Slack keys, generic `api_key=` | E050 |
| 5. Node sanity | Duplicate IDs/names, bad `typeVersion` / `position` / `parameters` | E010–E018 |
| 6. Parameter types | Required/optional fields match catalog schema, enum values valid | E060–E064 |

## Install

```bash
npm install @trngthnh369/n8n-workflow-validator
```

## Library usage

```ts
import { validate } from '@trngthnh369/n8n-workflow-validator';
import { readFileSync } from 'fs';

const workflow = JSON.parse(readFileSync('./my-workflow.json', 'utf8'));
const result = validate(workflow, { strict: false });

if (!result.valid) {
  console.error(`Found ${result.issues.length} issues`);
  for (const issue of result.issues) {
    console.error(`[${issue.severity}] ${issue.code}: ${issue.msg}`);
  }
}
```

### Custom catalog

```ts
import { validate } from '@trngthnh369/n8n-workflow-validator';

const customCatalog = {
  nodes: {
    'n8n-nodes-base.myCustomNode': {
      typeVersion: [1],
      required: { apiUrl: 'string' },
      optional: { timeout: 'number' },
      enums: {},
    },
  },
};

validate(workflow, { catalog: customCatalog });
```

## CLI usage

```bash
# After `npm install -g @trngthnh369/n8n-workflow-validator`
n8n-validate ./my-workflow.json
n8n-validate ./my-workflow.json --strict   # fail on MEDIUM issues too
```

## Severity & strict mode

- **CRITICAL / HIGH** → always fail (`valid: false`)
- **MEDIUM** → fail only with `{ strict: true }`

## Exit codes (CLI)

| Code | Meaning |
|------|---------|
| 0 | Valid |
| 1 | Invalid (issues found) |
| 2 | Usage error (missing file, bad args) |

## Node catalog

Ships with schemas for 21 native n8n nodes (httpRequest, code, set, if, switch, merge, splitInBatches, webhook, scheduleTrigger, manualTrigger, executeWorkflow, executeWorkflowTrigger, respondToWebhook, wait, filter, aggregate, googleSheets, gmail, slack, openAi, lmChatAnthropic).

To extend, pass your own catalog via the `catalog` option, or fork `node-catalog.json` and merge.

## License

MIT
