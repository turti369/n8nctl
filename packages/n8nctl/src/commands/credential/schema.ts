import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';

export function createSchemaCommand(): Command {
  return new Command('schema')
    .description('Fetch the schema (required fields) for a credential type')
    .argument('<type>', 'credential type name (e.g. "httpHeaderAuth", "googleSheetsOAuth2Api")')
    .action(
      withAction(async (factory, _opts, args) => {
        const [type] = args;
        const client = await factory.client();
        const schema = await client.get(`/credentials/schema/${encodeURIComponent(type)}`);
        await printData(schema, { io: factory.io, opts: factory.flags });
      }),
    );
}
