# `pipeline` umbrella command — go/no-go (1.0.0)

**Decision: NO-GO for 1.0. The primitives ship; the orchestrator stays a skill.**

The roadmap deferred the `pipeline run` umbrella (build → validate → deploy →
run → verify in one command) until the primitives existed and a *Claude-free*
consumer materialized. At 1.0 the primitives exist and compose cleanly:

- gate: `workflow verify` (exit 6) — `lib/lifecycle/verify.ts`
- rollback: `workflow rollback` — `lib/lifecycle/rollback.ts`
- promote: `workflow promote` — `lib/lifecycle/promote.ts`
- scaffold/validate/normalize/deploy: existing verbs

But the only consumer today is the **`n8n-pipeline` Claude skill**, which is an
orchestrator that *wants* human/LLM judgment at each gate (confirm-before-
activate, the 3-try fix loop, "proceed despite ĐỦ warning?"). Collapsing that
into a single non-interactive `pipeline run` would either (a) re-implement the
judgment the skill already provides, or (b) remove it — neither is an
improvement.

**Re-open the decision when** a genuinely Claude-free consumer appears — e.g. a
GitHub Actions job that must deploy workflows with no LLM in the loop. At that
point `pipeline run --plan <file>` becomes a thin sequencer over the existing
`lib/lifecycle/*` modules with checkpoint artifacts (each step writes its
`--out-dir` bundle; a failure stops the chain with the failing step's exit
code). The lifecycle layer was deliberately built pure (no printing/exiting) to
make that future command cheap.

This is a documented architectural decision, not deferred scope.
