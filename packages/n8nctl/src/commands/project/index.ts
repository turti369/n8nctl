import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { rethrowWithLicenseHint } from '../../lib/license.js';
import { createProjectManageCommands } from './manage.js';
import type { Factory } from '../../factory.js';

interface N8nProject {
  id: string;
  name?: string;
  type?: string;
}

export async function projectListHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const client = await factory.client();
  const projects: N8nProject[] = [];
  try {
    for await (const p of client.paginate<N8nProject>('/projects', { limit: 100 })) {
      projects.push(p);
    }
  } catch (err) {
    rethrowWithLicenseHint(err, 'Projects');
  }
  await printData(projects, { io: factory.io, opts: factory.flags }, (d) => {
    const rows = (d as N8nProject[]).map((p) => [p.id, p.name ?? '', p.type ?? '']);
    return { head: ['ID', 'NAME', 'TYPE'], rows };
  });
}

export function createProjectCommand(): Command {
  const cmd = new Command('project').description('Manage projects (licensed n8n feature)');
  cmd.addCommand(
    new Command('list').alias('ls').description('List projects').action(withAction(projectListHandler)),
  );
  for (const sub of createProjectManageCommands()) cmd.addCommand(sub);
  return cmd;
}
