import { describe, it, expect } from 'vitest';
import {
  webhookProbeTargets,
  hasNonWebhookTrigger,
  resolveNameMatch,
} from '../src/lib/lifecycle/deploy.js';

describe('webhookProbeTargets', () => {
  it('derives /webhook/<path> URLs for enabled webhook nodes only', () => {
    const nodes = [
      { name: 'Hook', type: 'n8n-nodes-base.webhook', parameters: { path: 'abc', httpMethod: 'post' } },
      { name: 'Disabled', type: 'n8n-nodes-base.webhook', disabled: true, parameters: { path: 'x' } },
      { name: 'NoPath', type: 'n8n-nodes-base.webhook', parameters: {} },
      { name: 'Set', type: 'n8n-nodes-base.set', parameters: {} },
    ];
    const targets = webhookProbeTargets(nodes, 'https://n8n.test/');
    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual({ nodeName: 'Hook', method: 'POST', url: 'https://n8n.test/webhook/abc' });
  });
});

describe('hasNonWebhookTrigger', () => {
  it('detects schedule/cron/manual triggers but not webhooks', () => {
    expect(hasNonWebhookTrigger([{ type: 'n8n-nodes-base.scheduleTrigger' }])).toBe(true);
    expect(hasNonWebhookTrigger([{ type: 'n8n-nodes-base.manualTrigger' }])).toBe(true);
    expect(hasNonWebhookTrigger([{ type: 'n8n-nodes-base.webhook' }])).toBe(false);
    expect(hasNonWebhookTrigger([{ type: 'n8n-nodes-base.set' }])).toBe(false);
    expect(hasNonWebhookTrigger([{ type: 'n8n-nodes-base.scheduleTrigger', disabled: true }])).toBe(false);
  });
});

describe('resolveNameMatch', () => {
  it('none → create', () => {
    expect(resolveNameMatch([])).toEqual({ kind: 'create' });
  });
  it('one → update with that id', () => {
    expect(resolveNameMatch([{ id: 'x' }])).toEqual({ kind: 'update', id: 'x' });
  });
  it('many → ambiguous with all ids', () => {
    expect(resolveNameMatch([{ id: 'a' }, { id: 'b' }])).toEqual({ kind: 'ambiguous', ids: ['a', 'b'] });
  });
});
