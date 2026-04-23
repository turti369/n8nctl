import { describe, it, expect } from 'vitest';
import { redactWorkflow } from '../src/lib/redact.js';

describe('redactWorkflow', () => {
  it('redacts pinData entirely', () => {
    const wf = { name: 'x', nodes: [], pinData: { 'Webhook': [{ json: { email: 'a@b.c' } }] } };
    const r = redactWorkflow(wf) as { pinData: unknown };
    expect(r.pinData).toBe('[REDACTED]');
  });

  it('redacts webhookId at any level', () => {
    const wf = {
      name: 'x',
      webhookId: 'wf-uuid',
      nodes: [
        { name: 'N', webhookId: 'node-uuid', parameters: {} },
      ],
    };
    const r = redactWorkflow(wf) as { webhookId: string; nodes: Array<{ webhookId: string }> };
    expect(r.webhookId).toBe('[REDACTED]');
    expect(r.nodes[0].webhookId).toBe('[REDACTED]');
  });

  it('redacts credentials.<type>.name but keeps id', () => {
    const wf = {
      nodes: [
        {
          name: 'Sheets',
          credentials: {
            googleSheetsOAuth2Api: { id: 'cred-123', name: 'Marketing Sheets (Prod)' },
          },
        },
      ],
    };
    const r = redactWorkflow(wf) as {
      nodes: Array<{ credentials: { googleSheetsOAuth2Api: { id: string; name: string } } }>;
    };
    expect(r.nodes[0].credentials.googleSheetsOAuth2Api.id).toBe('cred-123');
    expect(r.nodes[0].credentials.googleSheetsOAuth2Api.name).toBe('[REDACTED]');
  });

  it('keeps non-sensitive fields intact', () => {
    const wf = {
      id: '42',
      name: 'Workflow',
      active: true,
      nodes: [{ id: 'a', name: 'N', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
      connections: {},
    };
    const r = redactWorkflow(wf);
    expect(r).toEqual(wf);
  });

  it('handles null and undefined inputs', () => {
    expect(redactWorkflow(null)).toBeNull();
    expect(redactWorkflow(undefined)).toBeUndefined();
  });

  it('does not mutate input', () => {
    const wf = { pinData: { foo: 'bar' } };
    const snapshot = JSON.stringify(wf);
    redactWorkflow(wf);
    expect(JSON.stringify(wf)).toBe(snapshot);
  });

  it('handles deeply nested structures', () => {
    const wf = {
      nodes: [
        {
          name: 'Sub',
          parameters: {
            nested: {
              webhookId: 'deep-uuid',
              credentials: { slackApi: { id: 's1', name: 'Sensitive' } },
            },
          },
        },
      ],
    };
    const r = redactWorkflow(wf) as {
      nodes: Array<{ parameters: { nested: { webhookId: string; credentials: { slackApi: { name: string } } } } }>;
    };
    expect(r.nodes[0].parameters.nested.webhookId).toBe('[REDACTED]');
    expect(r.nodes[0].parameters.nested.credentials.slackApi.name).toBe('[REDACTED]');
  });
});
