import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { rethrowWithLicenseHint } from '../../lib/license.js';
import type { Factory } from '../../factory.js';

export interface N8nVariable {
  id: string;
  key: string;
  value?: string;
  type?: string;
}

export async function variableListHandler(
  factory: Factory,
  _opts: unknown,
  _args: string[],
): Promise<void> {
  const client = await factory.client();
  const vars: N8nVariable[] = [];
  try {
    for await (const v of client.paginate<N8nVariable>('/variables', { limit: 100 })) {
      vars.push(v);
    }
  } catch (err) {
    rethrowWithLicenseHint(err, 'Variables');
  }

  await printData(vars, { io: factory.io, opts: factory.flags }, (d) => {
    const rows = (d as N8nVariable[]).map((v) => [v.id, v.key, v.value ?? '']);
    return { head: ['ID', 'KEY', 'VALUE'], rows };
  });
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List instance variables (licensed feature)')
    .action(withAction(variableListHandler));
}
