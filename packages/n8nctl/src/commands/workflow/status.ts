import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { c } from '../../lib/io.js';
import type { Workflow, Execution, PaginatedResponse } from '../../types/n8n.js';

interface StatusOpts {
  exit?: boolean;
}

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show active state, tags, webhook URLs, and last execution for a workflow')
    .argument('<id>', 'workflow ID')
    .option('--exit', 'Exit 0 if active, 1 if inactive, regardless of output mode')
    .action(
      withAction<StatusOpts>(async (factory, opts, args) => {
        const [id] = args;
        const client = await factory.client();

        const wf = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);

        let lastExec: Execution | null = null;
        try {
          const resp = await client.get<PaginatedResponse<Execution>>('/executions', {
            workflowId: id,
            limit: 1,
          });
          lastExec = resp.data[0] ?? null;
        } catch {
          // /executions might be 403 in some setups — non-fatal for status display
        }

        const webhookNodes = (wf.nodes ?? [])
          .filter((n) => n.type === 'n8n-nodes-base.webhook' && !n.disabled)
          .map((n) => ({
            name: n.name,
            path: (n.parameters as { path?: string }).path,
            method: ((n.parameters as { httpMethod?: string }).httpMethod ?? 'POST').toUpperCase(),
          }));

        const auth = await factory.auth();
        const status = {
          id: wf.id,
          name: wf.name,
          active: wf.active,
          tags: wf.tags?.map((t) => t.name) ?? [],
          createdAt: wf.createdAt,
          updatedAt: wf.updatedAt,
          nodeCount: wf.nodes?.length ?? 0,
          webhooks: webhookNodes.map((n) => ({
            ...n,
            url: n.path ? `${auth.host}/webhook/${n.path}` : null,
            testUrl: n.path ? `${auth.host}/webhook-test/${n.path}` : null,
          })),
          lastExecution: lastExec
            ? {
                id: lastExec.id,
                status: lastExec.status ?? (lastExec.finished ? 'finished' : 'running'),
                startedAt: lastExec.startedAt,
                stoppedAt: lastExec.stoppedAt,
              }
            : null,
        };

        if (factory.flags.json || factory.flags.jq || factory.flags.template) {
          await printData(status, { io: factory.io, opts: factory.flags });
        } else {
          const activeBadge = wf.active ? c.green('● active') : c.dim('○ inactive');
          factory.io.stdout.write(
            `${c.bold(wf.name)} (${wf.id}) ${activeBadge}\n` +
              `  tags:        ${status.tags.length > 0 ? status.tags.join(', ') : c.dim('(none)')}\n` +
              `  nodes:       ${status.nodeCount}\n` +
              `  updated:     ${(wf.updatedAt ?? '').slice(0, 19).replace('T', ' ')}\n`,
          );
          if (status.webhooks.length > 0) {
            factory.io.stdout.write(`  webhooks:\n`);
            for (const w of status.webhooks) {
              const live = wf.active ? c.green(' (live)') : c.dim(' (not registered — workflow inactive)');
              factory.io.stdout.write(`    ${w.method} ${w.url}${live}\n`);
            }
          }
          if (status.lastExecution) {
            const e = status.lastExecution;
            const statusColor =
              e.status === 'success'
                ? c.green
                : e.status === 'error' || e.status === 'crashed'
                  ? c.red
                  : c.dim;
            factory.io.stdout.write(
              `  last exec:   ${e.id} ${statusColor(e.status)} at ${(e.startedAt ?? '').slice(0, 19).replace('T', ' ')}\n`,
            );
          } else {
            factory.io.stdout.write(`  last exec:   ${c.dim('(none)')}\n`);
          }
        }

        if (opts.exit || !factory.io.isTTY) {
          // Semantic status signal, NOT an error path: active→0, inactive→1.
          // Skills branch on these VALUES — preserve them; only the mechanism
          // changed from process.exit() so stdout flushes are not truncated.
          process.exitCode = wf.active ? 0 : 1;
        }
      }),
    );
}
