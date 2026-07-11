import { describe, it, expect } from 'vitest';
import type { Workflow as ValidatorWorkflow, WorkflowNode as ValidatorNode } from '@trngthnh369/n8n-workflow-validator';
import type { Workflow as CtlWorkflow, WorkflowNode as CtlNode } from '../src/types/n8n.js';

/**
 * The two packages deliberately keep separate Workflow types (the CLI's is
 * strict about what the Public API returns; the validator's is loose because
 * it validates UNTRUSTED input). This locks the boundary contract at compile
 * time: every CLI workflow must be assignable to the validator's input type,
 * so `validate(parsed)` / `autoValidate(...)` can never silently drift into a
 * cast. If either type changes incompatibly, this FILE STOPS COMPILING.
 */
type Assignable<A, B> = A extends B ? true : false;

// Compile-time assertions (values unused at runtime).
const wfAssignable: Assignable<CtlWorkflow, ValidatorWorkflow> = true;
const nodeAssignable: Assignable<CtlNode, ValidatorNode> = true;

describe('cross-package type compatibility (CLI → validator boundary)', () => {
  it('n8nctl Workflow is assignable to the validator input Workflow', () => {
    expect(wfAssignable).toBe(true);
    expect(nodeAssignable).toBe(true);
  });
});
