import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import type { Credential, PaginatedResponse } from '../../types/n8n.js';

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List credentials (names and types only — values never exposed)')
    .action(
      withAction(async (factory) => {
        const client = await factory.client();
        const resp = await client.get<PaginatedResponse<Credential>>('/credentials');
        await printData(resp.data, { io: factory.io, opts: factory.flags }, (d) => {
          const rows = (d as Credential[]).map((cred) => [
            cred.id,
            cred.name,
            cred.type,
            cred.updatedAt?.slice(0, 19).replace('T', ' ') ?? '',
          ]);
          return { head: ['ID', 'NAME', 'TYPE', 'UPDATED'], rows };
        });
      }),
    );
}
