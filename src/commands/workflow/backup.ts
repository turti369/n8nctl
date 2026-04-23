import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import type { Workflow } from '../../types/n8n.js';

interface BackupOpts {
  output?: string;
}

export function createBackupCommand(): Command {
  return new Command('backup')
    .description('Backup a workflow to a timestamped JSON file')
    .argument('<id>', 'workflow ID')
    .option('-o, --output <dir>', 'Output directory (default: ./_backups)')
    .action(
      withAction<BackupOpts>(async (factory, opts, args) => {
        const [id] = args;
        const client = await factory.client();
        const workflow = await client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);

        const outDir = path.resolve(opts.output ?? '_backups');
        await fs.mkdir(outDir, { recursive: true });

        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const slug = workflow.name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
        const filename = `${slug}_${id}_${ts}.json`;
        const outPath = path.join(outDir, filename);

        await fs.writeFile(outPath, JSON.stringify(workflow, null, 2), 'utf8');
        factory.io.stdout.write(
          `${c.green('✓')} backed up ${c.bold(workflow.name)} (${id}) → ${outPath}\n`,
        );
      }),
    );
}
