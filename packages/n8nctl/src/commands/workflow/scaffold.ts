import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { normalizeWorkflow } from '../../lib/normalize.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface ScaffoldOpts {
  /**
   * Named --from (not --template): a subcommand --template can never win
   * against the GLOBAL --template Handlebars-output flag — commander consumes
   * program-level options before dispatch (same pitfall as --profile/--policy).
   */
  from?: string;
  name?: string;
  output?: string;
  webhookPath?: string;
}

const BUILTIN_TEMPLATES = ['webhook', 'cron', 'manual'] as const;
type BuiltinTemplate = (typeof BUILTIN_TEMPLATES)[number];

/**
 * Builtin skeletons. Node ids are intentionally MISSING — normalizeWorkflow
 * derives deterministic UUIDs from node names, which is what makes scaffold
 * output byte-stable across runs (same name → same ids → same file).
 */
function builtinTemplate(kind: BuiltinTemplate, name: string, webhookPath?: string): Workflow {
  const settings = {
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'all',
    saveManualExecutions: true,
    executionOrder: 'v1',
  };
  const setNode = {
    name: 'Set Output',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [220, 0] as [number, number],
    parameters: {
      assignments: {
        assignments: [{ id: 'a1', name: 'ok', type: 'boolean', value: true }],
      },
    },
  };

  switch (kind) {
    case 'webhook':
      return {
        name,
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [0, 0],
            parameters: {
              path: webhookPath ?? name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''),
              httpMethod: 'POST',
              responseMode: 'onReceived',
            },
          },
          setNode,
        ],
        connections: { Webhook: { main: [[{ node: 'Set Output', type: 'main', index: 0 }]] } },
        settings,
      } as unknown as Workflow;
    case 'cron':
      return {
        name,
        nodes: [
          {
            name: 'Schedule Trigger',
            type: 'n8n-nodes-base.scheduleTrigger',
            // Keep in lock-step with the validator catalog's latest typeVersion
            // so `scaffold | validate --policy strict` passes (E072 is MEDIUM).
            typeVersion: 1.3,
            position: [0, 0],
            parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } },
          },
          setNode,
        ],
        connections: { 'Schedule Trigger': { main: [[{ node: 'Set Output', type: 'main', index: 0 }]] } },
        settings,
      } as unknown as Workflow;
    case 'manual':
      return {
        name,
        nodes: [
          {
            name: 'Manual Trigger',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          },
          setNode,
        ],
        connections: { 'Manual Trigger': { main: [[{ node: 'Set Output', type: 'main', index: 0 }]] } },
        settings,
      } as unknown as Workflow;
  }
}

export async function scaffoldHandler(
  factory: Factory,
  opts: ScaffoldOpts,
  _args: string[],
): Promise<void> {
  const template = opts.from ?? 'manual';
  const name = opts.name ?? 'New Workflow';

  let base: Workflow;
  if (BUILTIN_TEMPLATES.includes(template as BuiltinTemplate)) {
    base = builtinTemplate(template as BuiltinTemplate, name, opts.webhookPath);
  } else {
    // Treat as a template FILE path (the n8n-build skill's tier templates).
    const absPath = path.resolve(template);
    let parsed: Workflow;
    try {
      parsed = JSON.parse(await fs.readFile(absPath, 'utf8')) as Workflow;
    } catch (err) {
      throw new ValidationError(
        `Template "${template}" is not a builtin (${BUILTIN_TEMPLATES.join(', ')}) and could not be read as a file: ${(err as Error).message}`,
      );
    }
    parsed.name = name;
    base = parsed;
  }

  // Normalize → deterministic node ids + log settings → byte-stable output
  // that passes `workflow validate` out of the box.
  const { workflow } = normalizeWorkflow(base);
  const json = JSON.stringify(workflow, null, 2) + '\n';

  if (factory.flags.dryRun) {
    factory.io.stdout.write(
      `${c.yellow('[dry-run]')} would scaffold "${name}" (${template}, ${workflow.nodes?.length ?? 0} nodes)${opts.output ? ` → ${opts.output}` : ''}\n`,
    );
    return;
  }

  if (opts.output) {
    await fs.writeFile(path.resolve(opts.output), json, 'utf8');
    factory.io.stderr.write(`${c.green('✓')} scaffolded ${template} workflow → ${opts.output}\n`);
  } else {
    factory.io.stdout.write(json);
  }
}

export function createScaffoldCommand(): Command {
  return new Command('scaffold')
    .description(
      'Generate a normalize-clean, validator-clean workflow skeleton. Builtins: ' +
        `${BUILTIN_TEMPLATES.join(', ')}; or pass a template FILE to rename+normalize it. ` +
        'Output is byte-stable across runs (deterministic node ids).',
    )
    .option('--from <name|file>', `Builtin (${BUILTIN_TEMPLATES.join(', ')}) or a JSON template file (default: manual). Named --from because --template is the global Handlebars-output flag.`)
    .option('--name <name>', 'Workflow name (default: "New Workflow")')
    .option('--webhook-path <path>', 'Webhook path for the webhook template (default: slug of the name)')
    .option('-o, --output <file>', 'Write to file instead of stdout')
    .action(withAction<ScaffoldOpts>(scaffoldHandler));
}
