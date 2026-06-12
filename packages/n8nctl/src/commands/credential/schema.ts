import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import type { Factory } from '../../factory.js';

export async function credentialSchemaHandler(
  factory: Factory,
  _opts: unknown,
  args: string[],
): Promise<void> {
  const [type] = args;
  const client = await factory.client();
  const schema = await client.get(`/credentials/schema/${encodeURIComponent(type)}`);
  await printData(schema, { io: factory.io, opts: factory.flags });
}

export function createSchemaCommand(): Command {
  return new Command('schema')
    .description('Fetch the schema (required fields) for a credential type')
    .argument('<type>', 'credential type name (e.g. "httpHeaderAuth", "googleSheetsOAuth2Api")')
    .action(withAction(credentialSchemaHandler));
}
