import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import type { Factory } from '../../factory.js';

const require = createRequire(import.meta.url);

interface SchemaOpts {
  node?: string;
  list?: boolean;
}

interface NodeCatalogEntry {
  typeVersion: number[];
  required?: Record<string, string>;
  optional?: Record<string, string>;
  enums?: Record<string, string[]>;
  conditionalRequired?: Record<string, { when: Record<string, unknown>; type: string }>;
}

interface NodeCatalog {
  _meta?: { version?: string; description?: string };
  nodes: Record<string, NodeCatalogEntry>;
}

let catalogCache: NodeCatalog | null = null;

async function loadCatalog(): Promise<NodeCatalog | null> {
  if (catalogCache) return catalogCache;
  // Resolve catalog from the validator package (always installed alongside CLI)
  const candidates = [
    // Resolution path when n8nctl + validator are siblings in node_modules
    require.resolve('@trngthnh369/n8n-workflow-validator/node-catalog.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      catalogCache = JSON.parse(raw) as NodeCatalog;
      return catalogCache;
    } catch {
      continue;
    }
  }
  return null;
}

const WORKFLOW_SCHEMA = {
  description: 'n8n Workflow resource shape (subset). Use this when constructing workflow JSON to avoid fabricated field names.',
  type: 'object',
  fields: {
    name: { type: 'string', required: true, note: 'Display name shown in n8n UI' },
    nodes: {
      type: 'array',
      required: true,
      items: 'WorkflowNode',
      note: 'Each node must have id, name, type, typeVersion, position, parameters',
    },
    connections: {
      type: 'object',
      required: true,
      note: 'Map of source node name → output type → array of [{node, type, index}]',
    },
    settings: { type: 'object', required: false, note: 'Workflow-level settings (timezone, error workflow, etc.)' },
    staticData: { type: 'object | null', required: false, note: 'Persistent data across executions' },
    tags: { type: 'array<{id, name}>', required: false, note: 'Read-only on PUT — use workflow tag command instead' },
    active: { type: 'boolean', required: false, note: 'Read-only — use workflow activate / deactivate' },
    id: { type: 'string', required: false, note: 'Read-only — server-assigned. Strip on create/update body.' },
  },
  readOnlyFields: ['id', 'createdAt', 'updatedAt', 'versionId', 'active', 'tags'],
  examples: {
    minimalWebhookWorkflow: {
      name: 'My Webhook Workflow',
      nodes: [
        {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [0, 0],
          parameters: { path: 'my-endpoint', httpMethod: 'POST' },
        },
      ],
      connections: {},
    },
  },
};

const NODE_TYPE_HINTS: Record<string, string> = {
  webhook: 'n8n-nodes-base.webhook',
  http: 'n8n-nodes-base.httpRequest',
  code: 'n8n-nodes-base.code',
  set: 'n8n-nodes-base.set',
  if: 'n8n-nodes-base.if',
  switch: 'n8n-nodes-base.switch',
  merge: 'n8n-nodes-base.merge',
  schedule: 'n8n-nodes-base.scheduleTrigger',
  manual: 'n8n-nodes-base.manualTrigger',
  sheets: 'n8n-nodes-base.googleSheets',
  gmail: 'n8n-nodes-base.gmail',
  slack: 'n8n-nodes-base.slack',
  openai: '@n8n/n8n-nodes-langchain.openAi',
};

export async function schemaHandler(
  factory: Factory,
  opts: SchemaOpts,
  _args: string[],
): Promise<void> {
  const catalog = await loadCatalog();

  if (opts.list) {
    if (!catalog) {
      throw new ValidationError(
        'Node catalog not found',
        'Reinstall: npm install -g @trngthnh369/n8nctl@latest',
      );
    }
    const types = Object.keys(catalog.nodes).sort();
    await printData(
      { count: types.length, types, catalogVersion: catalog._meta?.version },
      { io: factory.io, opts: factory.flags },
    );
    return;
  }

  if (opts.node) {
    if (!catalog) {
      throw new ValidationError('Node catalog not found');
    }
    const fullType = catalog.nodes[opts.node]
      ? opts.node
      : NODE_TYPE_HINTS[opts.node.toLowerCase()] ?? opts.node;
    const entry = catalog.nodes[fullType];
    if (!entry) {
      throw new ValidationError(
        `Node type "${opts.node}" not in offline catalog`,
        `Try one of: ${Object.keys(catalog.nodes).slice(0, 8).join(', ')}, ... (use --list to see all)`,
      );
    }
    await printData(
      { type: fullType, ...entry },
      { io: factory.io, opts: factory.flags },
    );
    return;
  }

  // Default: workflow resource schema
  await printData(WORKFLOW_SCHEMA, { io: factory.io, opts: factory.flags });
}

export function createSchemaCommand(): Command {
  return new Command('schema')
    .description(
      'Show JSON shape of a Workflow resource (default) or per-node parameter schema (with --node). ' +
        'Use this to discover field names before constructing workflow JSON — prevents agents from fabricating names.',
    )
    .option('--node <type>', 'Show schema for a specific node type (e.g. n8n-nodes-base.httpRequest, or short name like "http")')
    .option('--list', 'List all node types in the offline catalog')
    .action(withAction<SchemaOpts>(schemaHandler));
}
