import { describe, expect, it } from 'vitest';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { mcpCompareHandler, mcpConfigHandler, mcpInfoHandler } from '../src/commands/mcp/index.js';

describe('mcp commands', () => {
  it('prints endpoint and guardrails without exposing the n8n API key', async () => {
    const env = makeFakeFactory({ json: true });

    await mcpInfoHandler(env.factory, {}, []);
    const out = env.stdout();
    const data = JSON.parse(out);

    expect(data.endpoint).toBe('https://test.example.com/mcp-server/http');
    expect(data.officialMcp.defaultPath).toBe('/mcp-server/http');
    expect(data.guardrails).toContain('Keep N8N_API_KEY separate from MCP bearer tokens.');
    expect(out).not.toContain('test-key');
  });

  it('generates codex streamable-http config with token env placeholder', async () => {
    const env = makeFakeFactory({ json: true });

    await mcpConfigHandler(
      env.factory,
      { client: 'codex', serverName: 'n8n-prod', tokenEnv: 'N8N_PROD_MCP_TOKEN' },
      [],
    );
    const data = JSON.parse(env.stdout());

    expect(data.client).toBe('codex');
    expect(data.config.mcp_servers['n8n-prod'].transport).toBe('streamable-http');
    expect(data.config.mcp_servers['n8n-prod'].url).toBe('https://test.example.com/mcp-server/http');
    expect(data.config.mcp_servers['n8n-prod'].headers.Authorization).toBe('Bearer ${N8N_PROD_MCP_TOKEN}');
    expect(env.stdout()).not.toContain('test-key');
  });

  it('compares official MCP, official CLI, and n8nctl positioning', async () => {
    const env = makeFakeFactory({ json: true });

    await mcpCompareHandler(env.factory, {}, []);
    const data = JSON.parse(env.stdout());

    expect(data.rows).toHaveLength(3);
    expect(data.rows.map((r: { tool: string }) => r.tool)).toEqual([
      'n8n instance MCP',
      'n8n CLI API client',
      'n8nctl',
    ]);
  });
});
