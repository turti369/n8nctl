import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import { parsePositiveInt } from '../../lib/util.js';
import type { Workflow } from '../../types/n8n.js';

interface ExportOpts {
  output?: string;
  concurrency?: string;
  active?: boolean;
  tag?: string;
}

export function createExportAllCommand(): Command {
  return new Command('export-all')
    .description('Backup every workflow on the instance to a directory (one JSON file per workflow)')
    .option('-o, --output <dir>', 'Output directory (default: ./_backups/<timestamp>/)')
    .option('--active', 'Export only active workflows')
    .option('--tag <tag>', 'Filter by tag name')
    .option('--concurrency <n>', 'Max parallel fetches (default: 5)')
    .action(
      withAction<ExportOpts>(async (factory, opts) => {
        const client = await factory.client();
        const concurrency = Math.min(20, parsePositiveInt(opts.concurrency, '--concurrency', 5));

        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outDir = path.resolve(opts.output ?? `./_backups/${ts}`);
        await fs.mkdir(outDir, { recursive: true });

        const baseParams: Record<string, unknown> = {};
        if (opts.active !== undefined) baseParams.active = opts.active;
        if (opts.tag) baseParams.tags = opts.tag;

        const summaries: Workflow[] = [];
        for await (const wf of client.paginate<Workflow>('/workflows', baseParams)) {
          summaries.push(wf);
        }

        if (factory.flags.dryRun) {
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would export ${summaries.length} workflows to ${outDir}\n`,
          );
          return;
        }

        const spinner = factory.io.spinner(`Exporting ${summaries.length} workflows...`).start();
        let done = 0;
        let failed = 0;
        const queue = [...summaries];

        const worker = async (): Promise<void> => {
          while (queue.length > 0) {
            const wf = queue.shift();
            if (!wf) return;
            try {
              const full = await client.get<Workflow>(`/workflows/${encodeURIComponent(wf.id)}`);
              const slug = full.name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
              const outPath = path.join(outDir, `${slug}_${full.id}.json`);
              await fs.writeFile(outPath, JSON.stringify(full, null, 2), 'utf8');
            } catch (err) {
              failed++;
              factory.io.stderr.write(
                `\n${c.red('✗')} ${wf.id} "${wf.name}": ${(err as Error).message}\n`,
              );
            } finally {
              done++;
              spinner.text = `Exported ${done}/${summaries.length} (${failed} failed)`;
            }
          }
        };

        await Promise.all(Array.from({ length: concurrency }, worker));
        if (failed === 0) {
          spinner.succeed(`Exported ${done} workflows to ${outDir}`);
        } else {
          spinner.warn(`Exported ${done - failed}/${done} — ${failed} failed (see above)`);
        }
      }),
    );
}
