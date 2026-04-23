import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { c } from '../../lib/io.js';
import { ApiError } from '../../lib/errors.js';
import type { WorkflowTag } from '../../types/n8n.js';

interface TagOpts {
  replace?: boolean;
  create?: boolean;
}

export function createTagCommand(): Command {
  return new Command('tag')
    .description('Assign tag(s) to a workflow (appends by default, use --replace to overwrite)')
    .argument('<id>', 'workflow ID')
    .argument('<tag-names...>', 'one or more tag names')
    .option('--replace', 'Replace all existing tags instead of appending')
    .option('--create', 'Create tags that do not yet exist')
    .action(
      withAction<TagOpts>(async (factory, opts, args) => {
        const id = args[0];
        const tagNames = args.slice(1);
        const client = await factory.client();

        const allTags = await client.get<{ data: WorkflowTag[] }>('/tags', { limit: 250 });
        const byName = new Map(allTags.data.map((t) => [t.name.toLowerCase(), t]));

        const resolved: WorkflowTag[] = [];
        for (const name of tagNames) {
          const existing = byName.get(name.toLowerCase());
          if (existing) {
            resolved.push(existing);
            continue;
          }
          if (!opts.create) {
            throw new ApiError(
              `Tag "${name}" not found`,
              404,
              null,
              'Pass --create to create missing tags automatically.',
            );
          }
          const created = await client.post<WorkflowTag>('/tags', { name });
          resolved.push(created);
          byName.set(name.toLowerCase(), created);
          factory.io.stderr.write(`${c.dim('→')} created tag "${name}" (${created.id})\n`);
        }

        let finalTagIds: string[];
        if (opts.replace) {
          finalTagIds = resolved.map((t) => t.id);
        } else {
          const current = await client.get<WorkflowTag[]>(
            `/workflows/${encodeURIComponent(id)}/tags`,
          );
          const merged = new Map(current.map((t) => [t.id, t]));
          resolved.forEach((t) => merged.set(t.id, t));
          finalTagIds = [...merged.keys()];
        }

        if (factory.flags.dryRun) {
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would set tags on ${id} → [${resolved.map((t) => t.name).join(', ')}]\n`,
          );
          return;
        }

        await client.put(
          `/workflows/${encodeURIComponent(id)}/tags`,
          finalTagIds.map((tId) => ({ id: tId })),
        );
        factory.io.stdout.write(
          `${c.green('✓')} tagged ${c.bold(id)} with [${resolved.map((t) => t.name).join(', ')}]\n`,
        );
      }),
    );
}
