# `pipeline` / `workflow deploy` sequencer — decision log

> **UPDATE (1.4.0, 2026-07-04): RE-OPENED and shipped as `workflow deploy`.**
> The reopen condition below ("a genuinely Claude-free consumer") is now met: the
> live e2e CI job (`scripts/e2e/smoke.sh` / `.github/workflows/e2e-smoke.yml`)
> deploys a workflow with **no LLM in the loop**, and needs a single
> non-interactive command rather than re-implementing the sequence in bash.
> `workflow deploy` is that thin sequencer over the existing `lib/lifecycle/*`
> primitives (normalize → validate → create-or-update → activate →
> trigger-registration probe → run → verify gate), with unique-name safety,
> transaction-log rollback (`--rollback-on-fail`), and exit-code contract
> (3 validation/ambiguity, 6 gate/registration). The interactive `n8n-pipeline`
> skill remains for judgment-bearing, human-in-the-loop deploys. This supersedes
> the 1.0 NO-GO below.

---

# `pipeline` umbrella command — go/no-go (1.0.0, superseded)

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
