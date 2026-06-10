import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

interface RefreshOpts {
  delay?: string;
}

export function createRefreshCommand(): Command {
  return new Command('refresh')
    .description(
      'Cycle a workflow active state (deactivate → wait → activate) to nudge the ' +
        'n8n webhook/schedule router into re-registering handlers after an API update. ' +
        'NOTE: on single-main n8n this re-registers; on queue mode or a separate ' +
        'webhook process the in-process router may NOT pick it up — only a UI "Save" ' +
        '(or n8n restart) is guaranteed to register webhook/cron triggers.',
    )
    .argument('<id>', 'workflow ID')
    .option('--delay <ms>', 'Pause between deactivate and activate (default: 500)', (v) => Number(v))
    .action(
      withAction<RefreshOpts>(async (factory, opts, args) => {
        const [id] = args;
        const client = await factory.client();
        const delay = opts.delay !== undefined ? Number(opts.delay) : 500;

        const before = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);

        if (!before.active) {
          factory.io.stderr.write(
            `${c.yellow('!')} workflow "${before.name}" (${id}) is inactive — nothing to refresh\n` +
              `${c.dim('hint:')} run \`n8nctl workflow activate ${id}\` to set active (then UI "Save" if webhook/cron still doesn't fire)\n`,
          );
          process.exit(1);
        }

        if (factory.flags.dryRun) {
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would cycle "${before.name}" (${id}): deactivate → wait ${delay}ms → activate\n`,
          );
          return;
        }

        factory.io.stderr.write(`${c.dim('→')} deactivating ${id}...\n`);
        await client.post<Workflow>(`/workflows/${encodeURIComponent(id)}/deactivate`);

        if (delay > 0) {
          await sleep(delay);
        }

        factory.io.stderr.write(`${c.dim('→')} activating ${id}...\n`);
        const after = await client.post<Workflow>(`/workflows/${encodeURIComponent(id)}/activate`);

        if (!after.active) {
          factory.io.stderr.write(
            `${c.red('✗')} cycle completed but workflow is still reported inactive\n`,
          );
          process.exit(1);
        }
        factory.io.stdout.write(
          `${c.green('✓')} cycled "${after.name}" (${id}) → active\n`,
        );
        factory.io.stderr.write(
          `${c.yellow('note')}: active=true is set in the DB. If a webhook still 404s or a ` +
            `cron does not fire, the running n8n process did not re-register — do a UI "Save" ` +
            `on the workflow (or restart n8n) to register triggers.\n`,
        );
      }),
    );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
