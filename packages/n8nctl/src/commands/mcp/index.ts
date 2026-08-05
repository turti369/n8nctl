import { Command, Option } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import type { Factory } from '../../factory.js';

type McpClient = 'claude' | 'cursor' | 'codex' | 'generic';

interface McpCommonOpts {
  endpoint?: string;
  tokenEnv?: string;
  serverName?: string;
}

interface McpConfigOpts extends McpCommonOpts {
  client?: McpClient;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildMcpEndpoint(host: string, override?: string): string {
  return override ? override : `${trimTrailingSlash(host)}/mcp-server/http`;
}

function buildAuthHeader(tokenEnv = 'N8N_MCP_TOKEN'): string {
  return `Bearer \${${tokenEnv}}`;
}

function buildClientConfig(
  client: McpClient,
  endpoint: string,
  serverName = 'n8n',
  tokenEnv = 'N8N_MCP_TOKEN',
): unknown {
  const base = {
    url: endpoint,
    headers: {
      Authorization: buildAuthHeader(tokenEnv),
    },
  };

  if (client === 'generic') {
    return {
      transport: 'streamable-http',
      serverName,
      ...base,
    };
  }

  if (client === 'codex') {
    return {
      mcp_servers: {
        [serverName]: {
          transport: 'streamable-http',
          ...base,
        },
      },
    };
  }

  return {
    mcpServers: {
      [serverName]: {
        transport: 'streamable-http',
        ...base,
      },
    },
  };
}

function buildMcpInfo(host: string, opts: McpCommonOpts = {}) {
  const endpoint = buildMcpEndpoint(host, opts.endpoint);
  const tokenEnv = opts.tokenEnv ?? 'N8N_MCP_TOKEN';

  return {
    endpoint,
    tokenEnv,
    officialMcp: {
      role: 'Expose selected n8n workflows/tools to MCP clients through n8n instance-level MCP.',
      expectedTransport: 'streamable-http',
      defaultPath: '/mcp-server/http',
      auth: `Use a separate MCP bearer token, usually supplied as ${tokenEnv}. Do not reuse or print N8N_API_KEY.`,
    },
    officialCli: {
      role: 'Official n8n API client / CLI generated from the public API surface. Treat as a useful beta companion, not a replacement for deployment guardrails.',
      bestFor: ['direct public API calls', 'OpenAPI-aligned resource coverage', 'experiments against official API behavior'],
    },
    n8nctlLayer: {
      role: 'Production-safe agent layer around n8n: validation, redaction, DRY_RUN, profile safety, workflow promotion, rollback, and packaging checks.',
      bestFor: [
        'agentic workflow delivery',
        'template pack validation',
        'multi-instance promotion',
        'no-secret audit and buyer handoff',
      ],
    },
    guardrails: [
      'Keep N8N_API_KEY separate from MCP bearer tokens.',
      'Expose only workflows/tools that are safe for agent use.',
      'Prefer read-only or dry-run tools until a human approves writes.',
      'Validate workflow JSON before publishing or importing templates.',
      'Document env vars, credentials, and support path for every sellable pack.',
    ],
  };
}

export async function mcpInfoHandler(
  factory: Factory,
  opts: McpCommonOpts,
  _args: string[],
): Promise<void> {
  const auth = await factory.auth();
  const info = buildMcpInfo(auth.host, opts);
  await printData(info, { io: factory.io, opts: factory.flags });
}

export async function mcpConfigHandler(
  factory: Factory,
  opts: McpConfigOpts,
  _args: string[],
): Promise<void> {
  const auth = await factory.auth();
  const client = opts.client ?? 'claude';
  const endpoint = buildMcpEndpoint(auth.host, opts.endpoint);
  const serverName = opts.serverName ?? 'n8n';
  const tokenEnv = opts.tokenEnv ?? 'N8N_MCP_TOKEN';
  const config = buildClientConfig(client, endpoint, serverName, tokenEnv);

  await printData(
    {
      client,
      serverName,
      endpoint,
      tokenEnv,
      config,
      nextSteps: [
        `Set ${tokenEnv} to the MCP bearer token generated/configured in n8n.`,
        'Add the config snippet to your MCP client.',
        'Run `n8nctl mcp info --json` to review safety guardrails before exposing write tools.',
      ],
    },
    { io: factory.io, opts: factory.flags },
  );
}

export async function mcpCompareHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const rows = [
    {
      tool: 'n8n instance MCP',
      owner: 'n8n',
      status: 'official MCP surface',
      bestFor: 'Exposing curated workflow/tools to Claude, Cursor, Codex, and other MCP clients.',
      n8nctlPosition: 'Consume/verify the same instance safely; do not duplicate MCP runtime.',
    },
    {
      tool: 'n8n CLI API client',
      owner: 'n8n',
      status: 'official beta API client',
      bestFor: 'OpenAPI-aligned resource calls and parity checks against public API behavior.',
      n8nctlPosition: 'Use as reference/companion while n8nctl owns guardrails and delivery workflows.',
    },
    {
      tool: 'n8nctl',
      owner: '@trngthnh369',
      status: 'agent-safe ops layer',
      bestFor: 'Validate, normalize, diff, backup, promote, rollback, package, and verify workflows.',
      n8nctlPosition: 'Differentiate on production safety, DRY_RUN, redaction, templates, and agent handoff.',
    },
  ];

  await printData(
    { rows },
    { io: factory.io, opts: factory.flags },
    () => ({
      head: ['Tool', 'Owner', 'Status', 'Best for', 'n8nctl position'],
      rows: rows.map((r) => [r.tool, r.owner, r.status, r.bestFor, r.n8nctlPosition]),
    }),
  );

  if (!factory.flags.json && !factory.flags.jq && !factory.flags.template) {
    factory.io.stdout.write(
      `\n${c.bold('Recommended:')} keep n8nctl focused on validation, packaging, promotion, rollback, and agent-safe guardrails.\n`,
    );
  }
}

export function createMcpCommand(): Command {
  const cmd = new Command('mcp')
    .description('Plan and configure n8n instance-level MCP access without leaking API keys');

  const endpointOpt = new Option('--endpoint <url>', 'Override MCP endpoint (default: <host>/mcp-server/http)');
  const tokenEnvOpt = new Option('--token-env <name>', 'Environment variable that stores the MCP bearer token')
    .default('N8N_MCP_TOKEN');
  const serverNameOpt = new Option('--server-name <name>', 'MCP server name in generated client config')
    .default('n8n');

  cmd
    .command('info')
    .description('Show n8n MCP endpoint, official CLI positioning, and production safety guardrails')
    .addOption(endpointOpt)
    .addOption(tokenEnvOpt)
    .action(withAction<McpCommonOpts>(mcpInfoHandler));

  cmd
    .command('config')
    .description('Generate a MCP client config snippet for n8n instance-level MCP')
    .addOption(new Option('--client <client>', 'Target MCP client config shape').choices(['claude', 'cursor', 'codex', 'generic']).default('claude'))
    .addOption(endpointOpt)
    .addOption(tokenEnvOpt)
    .addOption(serverNameOpt)
    .action(withAction<McpConfigOpts>(mcpConfigHandler));

  cmd
    .command('compare')
    .description('Compare official n8n MCP, official n8n CLI, and n8nctl responsibilities')
    .action(withAction(mcpCompareHandler));

  return cmd;
}
