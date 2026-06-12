import { table, type TableUserConfig } from 'table';
import Handlebars from 'handlebars';
import jq from 'node-jq';
import { ValidationError } from './errors.js';
import type { IoStreams } from './io.js';

export interface OutputOptions {
  json?: boolean;
  jq?: string;
  template?: string;
  output?: string;
}

export interface PrintContext {
  io: IoStreams;
  opts: OutputOptions;
}

export async function printData(
  data: unknown,
  ctx: PrintContext,
  tableView?: (d: unknown) => { head: string[]; rows: string[][] },
): Promise<void> {
  if (ctx.opts.jq) {
    const result = await jq.run(ctx.opts.jq, JSON.stringify(data), { input: 'string', output: 'json' });
    ctx.io.stdout.write(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    ctx.io.stdout.write('\n');
    return;
  }

  if (ctx.opts.template) {
    ctx.io.stdout.write(renderTemplate(ctx.opts.template, data));
    ctx.io.stdout.write('\n');
    return;
  }

  if (ctx.opts.json || !ctx.io.isTTY) {
    ctx.io.stdout.write(JSON.stringify(data, null, 2));
    ctx.io.stdout.write('\n');
    return;
  }

  if (tableView) {
    const view = tableView(data);
    const config: TableUserConfig = {
      border: {
        topBody: '─', topJoin: '┬', topLeft: '┌', topRight: '┐',
        bottomBody: '─', bottomJoin: '┴', bottomLeft: '└', bottomRight: '┘',
        bodyLeft: '│', bodyRight: '│', bodyJoin: '│',
        joinBody: '─', joinLeft: '├', joinRight: '┤', joinJoin: '┼',
      },
    };
    ctx.io.stdout.write(table([view.head, ...view.rows], config));
    return;
  }

  ctx.io.stdout.write(JSON.stringify(data, null, 2));
  ctx.io.stdout.write('\n');
}

/**
 * Render a user-supplied Handlebars template against data.
 *
 * Sandboxing decisions:
 * - Use `Handlebars.create()` per render so registered helpers don't leak
 *   between commands and template state is isolated.
 * - `noEscape: true` — output is terminal text, not HTML.
 * - `strict: true` — reference to an undefined property throws instead of
 *   silently rendering empty string. Catches template typos early.
 * - `assumeObjects: false` — do not assume every reference is an object.
 * - Do NOT enable `compat` mode — skips legacy look-up behaviors that could
 *   aid prototype traversal.
 *
 * Helpers exposed: `newline`, `json` (pretty-print a value).
 */
export function renderTemplate(template: string, data: unknown): string {
  const hb = Handlebars.create();
  hb.registerHelper('newline', () => '\n');
  hb.registerHelper('json', (value: unknown) => JSON.stringify(value, null, 2));

  const compiled = hb.compile(template, {
    noEscape: true,
    strict: true,
    assumeObjects: false,
  });

  try {
    return compiled(data);
  } catch (err) {
    throw new ValidationError(
      `Template render failed: ${(err as Error).message}`,
      'Check that all referenced fields exist in the data.',
    );
  }
}

export function validateOutputOptions(opts: OutputOptions): void {
  const flags = [opts.json, !!opts.jq, !!opts.template].filter(Boolean).length;
  if (flags > 1) {
    throw new ValidationError(
      'Only one of --json, --jq, --template may be used at once.',
    );
  }
}
