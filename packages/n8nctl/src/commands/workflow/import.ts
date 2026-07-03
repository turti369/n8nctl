import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withAction } from '../../lib/runtime.js';
import { ValidationError, ApiError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { stripReadOnlyFields } from '../../lib/workflow-body.js';
import { parsePositiveInt } from '../../lib/util.js';
import { autoValidate, type AutoValidateOpts } from '../../lib/auto-validate.js';
import type { Factory } from '../../factory.js';
import type { Workflow } from '../../types/n8n.js';

interface ImportOpts extends AutoValidateOpts {
  force?: boolean;
  activate?: boolean;
  concurrency?: string;
}

export async function importHandler(
  factory: Factory,
  opts: ImportOpts,
  args: string[],
): Promise<void> {
  const [dir] = args;
  const absDir = path.resolve(dir);
  const stat = await fs.stat(absDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new ValidationError(`${absDir} is not a directory`);
  }

  const entries = (await fs.readdir(absDir)).filter((f) => f.endsWith('.json'));
  if (entries.length === 0) {
    factory.io.stderr.write(`${c.yellow('!')} no .json files in ${absDir}\n`);
    return;
  }

  const client = await factory.client();
  const concurrency = Math.min(10, parsePositiveInt(opts.concurrency, '--concurrency', 3));

  type Task = { file: string; workflow: Workflow };
  const tasks: Task[] = [];
  for (const file of entries) {
    const full = path.join(absDir, file);
    try {
      const wf = JSON.parse(await fs.readFile(full, 'utf8')) as Workflow;
      tasks.push({ file, workflow: wf });
    } catch (err) {
      factory.io.stderr.write(
        `${c.red('skip')} ${file}: invalid JSON — ${(err as Error).message}\n`,
      );
    }
  }

  if (factory.flags.dryRun) {
    for (const t of tasks) {
      factory.io.stdout.write(
        `${c.yellow('[dry-run]')} ${t.workflow.id ? 'update' : 'create'} ${c.bold(t.file)} → ${t.workflow.name}\n`,
      );
    }
    return;
  }

  const queue = [...tasks];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) return;
      try {
        // Warn-only by default; --validate-policy blocks (fails this file only).
        autoValidate(factory, task.workflow, opts);
        const body = stripReadOnlyFields(task.workflow);
        let result: Workflow;
        if (task.workflow.id) {
          const exists = await client
            .get<Workflow>(`/workflows/${encodeURIComponent(task.workflow.id)}`)
            .then(() => true)
            .catch((e: unknown) => {
              if (e instanceof ApiError && e.status === 404) return false;
              throw e;
            });
          if (exists && !opts.force) {
            factory.io.stderr.write(
              `${c.dim('skip')} ${task.file}: workflow ${task.workflow.id} exists (use --force)\n`,
            );
            skipped++;
            continue;
          }
          if (exists) {
            result = await client.put<Workflow>(
              `/workflows/${encodeURIComponent(task.workflow.id)}`,
              body,
            );
            updated++;
          } else {
            result = await client.post<Workflow>('/workflows', body);
            created++;
          }
        } else {
          result = await client.post<Workflow>('/workflows', body);
          created++;
        }

        if (opts.activate && !result.active) {
          await client.post(`/workflows/${encodeURIComponent(result.id)}/activate`);
        }
        factory.io.stderr.write(
          `${c.green('✓')} ${task.file} → ${result.id} "${result.name}"\n`,
        );
      } catch (err) {
        failed++;
        factory.io.stderr.write(
          `${c.red('✗')} ${task.file}: ${(err as Error).message}\n`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  factory.io.stdout.write(
    `\n${c.bold('Summary')}: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed\n`,
  );
}

export function createImportCommand(): Command {
  return new Command('import')
    .description('Import workflows from a directory (creates or updates)')
    .argument('<dir>', 'directory containing workflow JSON files')
    .option('--force', 'Overwrite existing workflows (default: skip)')
    .option('--activate', 'Activate each imported workflow')
    .option('--concurrency <n>', 'Max parallel imports (default: 3)')
    .option('--no-validate', 'Skip pre-deploy workflow validation')
    .option('--validate-policy <p>', 'Block on validation issues per policy (dev|ci|strict). Default: warn only.')
    .action(withAction<ImportOpts>(importHandler));
}
