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
    Handlebars.registerHelper('newline', () => '\n');
    const compiled = Handlebars.compile(ctx.opts.template, { noEscape: true });
    ctx.io.stdout.write(compiled(data));
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

export function validateOutputOptions(opts: OutputOptions): void {
  const flags = [opts.json, !!opts.jq, !!opts.template].filter(Boolean).length;
  if (flags > 1) {
    throw new ValidationError(
      'Only one of --json, --jq, --template may be used at once.',
    );
  }
}
