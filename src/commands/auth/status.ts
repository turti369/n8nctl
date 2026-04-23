import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { resolveAuth } from '../../lib/auth.js';
import { N8nClient } from '../../lib/api.js';
import { c } from '../../lib/io.js';

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show active authentication and verify connectivity')
    .action(
      withAction(async (factory) => {
        const auth = await resolveAuth({
          apiKey: factory.flags.apiKey,
          host: factory.flags.host,
          profile: factory.flags.profile,
        });

        factory.io.stdout.write(`${c.bold('Profile:')} ${auth.profileName}\n`);
        factory.io.stdout.write(`${c.bold('Host:')}    ${auth.host}\n`);
        factory.io.stdout.write(`${c.bold('Source:')}  ${auth.source}\n`);
        factory.io.stdout.write(`${c.bold('API key:')} ${maskKey(auth.apiKey)}\n\n`);

        const spinner = factory.io.spinner('Pinging n8n...').start();
        try {
          const client = new N8nClient(auth);
          await client.get('/workflows', { limit: 1 });
          spinner.succeed(`${c.green('authenticated')} — API reachable`);
        } catch (err) {
          spinner.fail(`${c.red('failed')}: ${(err as Error).message}`);
          throw err;
        }
      }),
    );
}

function maskKey(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '...' + key.slice(-4);
}
