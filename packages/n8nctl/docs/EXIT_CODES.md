# n8nctl exit codes

A stable contract for scripts and AI agents. Values are frozen — new meanings
get new numbers, existing numbers never change meaning.

| Code | Name | Meaning |
|---|---|---|
| 0 | Success | Command completed; for gate commands, the assertion/state check passed |
| 1 | ApiError | n8n API returned a non-2xx the CLI could not handle (4xx/5xx) |
| 2 | AuthError | Missing/invalid credentials; run `n8nctl auth login` |
| 3 | ValidationError | Bad input — invalid flag value, malformed JSON, failed local validation |
| 4 | NetworkError | Host unreachable / TLS / DNS / connection failure |
| 5 | InternalError | Unexpected CLI failure (bug) — re-run with `N8NCTL_DEBUG=1` |
| 6 | AssertionFailed | The workflow/request RAN, but a stated expectation failed: `workflow verify` gate (CẦN/ĐỦ), `trigger-webhook --expect-status` mismatch. Added in 0.7.0 |

## Semantic status signals (not errors)

Some commands set the exit code as a **query result**, not a failure:

- `workflow status --exit` → `0` if active, `1` if inactive.
- `workflow run --wait` / `execution wait` → `0` on terminal `success`, `1` otherwise.
- `workflow refresh` → `1` if the workflow was inactive (nothing to refresh) or
  still inactive after cycling.

These reuse code `1`; consumers that branch specifically on these commands
should treat `1` as the "false/failed-run" answer, not an infrastructure error.

## Policy (for contributors)

- Command handlers MUST NOT call `process.exit()`. Only `runtime.ts handleError`
  exits the process (so pending stdout/stderr flushes are not truncated on
  Windows). Handlers set `process.exitCode` and `return`, or throw an
  `N8nCtlError` subclass (which maps to the table above).
- `6 = AssertionFailed` is ACTIVE since 0.7.0 (`workflow verify`,
  `trigger-webhook --expect-status`). Scripts that treated every non-zero as
  "infra failure" should special-case 6 as "ran fine, assertion failed".
