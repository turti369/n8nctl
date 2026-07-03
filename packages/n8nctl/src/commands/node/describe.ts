import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { loadNodeCatalog, resolveNodeType, versionsLabel } from '../../lib/node-catalog.js';
import type { NodeProperty } from '../../lib/node-catalog.js';
import type { Factory } from '../../factory.js';

export interface NodeDescribeOpts {
  property?: string;
  requiredOnly?: boolean;
  refresh?: boolean;
}

function truncate(v: unknown, n = 40): string {
  if (v === undefined || v === null || v === '') return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export async function nodeDescribeHandler(
  factory: Factory,
  opts: NodeDescribeOpts,
  args: string[],
): Promise<void> {
  const [query] = args;
  if (!query) throw new ValidationError('a node type is required', 'e.g. `n8nctl node describe httpRequest`');

  const session = await factory.sessionClient();
  const all = await loadNodeCatalog(session, { refresh: opts.refresh });
  const node = resolveNodeType(all, query);
  if (!node) {
    throw new ValidationError(
      `no node matches "${query}"`,
      'Run `n8nctl node list --search <text>` to find the exact type.',
    );
  }

  let props: NodeProperty[] = node.properties ?? [];
  if (opts.property) {
    const pl = opts.property.toLowerCase();
    props = props.filter((p) => p.name?.toLowerCase() === pl || p.displayName?.toLowerCase() === pl);
  }
  if (opts.requiredOnly) props = props.filter((p) => p.required);

  const summary = {
    type: node.name,
    displayName: node.displayName,
    description: node.description,
    versions: versionsLabel(node),
    defaultVersion: node.defaultVersion,
    group: node.group,
    credentials: (node.credentials ?? []).map((c) => c.name),
    usableAsTool: node.usableAsTool ?? false,
    propertyCount: (node.properties ?? []).length,
    properties: props.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required ?? false,
      default: p.default,
      description: p.description,
    })),
  };

  await printData(summary, { io: factory.io, opts: factory.flags }, (d) => {
    const s = d as typeof summary;
    factory.io.stdout.write(
      `${s.type}  (${s.displayName})\n` +
        `  versions: ${s.versions}  default: ${s.defaultVersion ?? '—'}  tool: ${s.usableAsTool}\n` +
        `  credentials: ${s.credentials.length ? s.credentials.join(', ') : '—'}\n` +
        (s.description ? `  ${s.description}\n` : '') +
        `\n`,
    );
    const rows = s.properties.map((p) => [
      p.name ?? '',
      p.type ?? '',
      p.required ? 'yes' : '',
      truncate(p.default),
      truncate(p.description, 50),
    ]);
    return { head: ['PROPERTY', 'TYPE', 'REQ', 'DEFAULT', 'DESCRIPTION'], rows };
  });
}

export function createNodeDescribeCommand(): Command {
  return new Command('describe')
    .alias('show')
    .description('Show a node type schema (params, versions, credentials) from the live catalog')
    .argument('<type>', 'node type — full (n8n-nodes-base.httpRequest) or short (httpRequest / http)')
    .option('--property <name>', 'Show only this property')
    .option('--required-only', 'Show only required properties')
    .option('--refresh', 'Force refetch the catalog (bypass the 24h cache)')
    .action(withAction<NodeDescribeOpts>(nodeDescribeHandler));
}
