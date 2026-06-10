import { Command } from 'commander';
import { withAction } from '../../lib/runtime.js';
import { printData } from '../../lib/output.js';
import { ValidationError } from '../../lib/errors.js';
import { c } from '../../lib/io.js';
import { readJsonSource } from '../../lib/stdin.js';
import type { N8nClient } from '../../lib/api.js';

interface CreateOpts {
  validate?: boolean;
}

export interface CredentialPayload {
  name: string;
  type: string;
  data: Record<string, unknown>;
}

interface CredentialSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

interface CreatedCredential {
  id: string;
  name: string;
  type: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Validate that the parsed JSON has the shape n8n expects for POST /credentials.
 * Pure helper — no I/O, exposed for unit testing.
 */
export function assertCredentialPayload(input: unknown): asserts input is CredentialPayload {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Credential payload must be a JSON object');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    throw new ValidationError('Credential payload missing required field "name" (non-empty string)');
  }
  if (typeof obj.type !== 'string' || obj.type.trim() === '') {
    throw new ValidationError('Credential payload missing required field "type" (non-empty string)');
  }
  if (obj.data === null || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    throw new ValidationError(
      'Credential payload missing required field "data" (object of {fieldName: value})',
    );
  }
}

/**
 * Validate the user-supplied `data` object against n8n's schema for the type.
 * We only enforce that all `required` field names are present — the n8n API
 * itself surfaces type errors on POST. This keeps us forward-compatible with
 * schema variations between n8n versions.
 */
export function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: CredentialSchema,
  credType: string,
): void {
  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter(
    (key) => !(key in data) || data[key] === undefined || data[key] === null,
  );
  if (missing.length > 0) {
    throw new ValidationError(
      `Credential type "${credType}" requires fields: ${missing.join(', ')}`,
      'Run `n8nctl credential schema ' + credType + '` to see the full schema, ' +
        'or pass --no-validate to skip this check.',
    );
  }
}

async function fetchSchema(client: N8nClient, credType: string): Promise<CredentialSchema | null> {
  try {
    return await client.get<CredentialSchema>(
      `/credentials/schema/${encodeURIComponent(credType)}`,
    );
  } catch {
    return null;
  }
}

export function createCreateCommand(): Command {
  return new Command('create')
    .description('Create a credential from a JSON file (use "-" for stdin)')
    .argument(
      '<file>',
      'path to credential JSON file ({name, type, data}), or "-" to read stdin',
    )
    .option(
      '--no-validate',
      'Skip schema validation against /credentials/schema/<type> before POST',
    )
    .action(
      withAction<CreateOpts>(async (factory, opts, args) => {
        const [file] = args;
        const { raw, source } = await readJsonSource(file);

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          throw new ValidationError(`Invalid JSON in ${source}: ${(err as Error).message}`);
        }

        assertCredentialPayload(parsed);
        const body: CredentialPayload = {
          name: parsed.name,
          type: parsed.type,
          data: parsed.data,
        };

        const client = await factory.client();

        if (opts.validate !== false) {
          const schema = await fetchSchema(client, body.type);
          if (schema) {
            validateAgainstSchema(body.data, schema, body.type);
          } else {
            factory.io.event(
              'credential-schema-unavailable',
              { level: 'warn', type: body.type },
              `${c.yellow('warning')}: could not fetch schema for "${body.type}" — skipping pre-validation`,
            );
          }
        }

        if (factory.flags.dryRun) {
          const fieldCount = Object.keys(body.data).length;
          factory.io.stdout.write(
            `${c.yellow('[dry-run]')} would create credential "${body.name}" ` +
              `(type=${body.type}, ${fieldCount} data fields) from ${source}\n`,
          );
          return;
        }

        const created = await client.post<CreatedCredential>('/credentials', body);

        factory.io.event(
          'credential-created',
          { id: created.id, type: created.type, name: created.name },
          `${c.green('✓')} created credential ${c.bold(created.id)} "${created.name}" (${created.type})`,
        );

        const safeView = {
          id: created.id,
          name: created.name,
          type: created.type,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        };
        await printData(safeView, { io: factory.io, opts: factory.flags });
      }),
    );
}
