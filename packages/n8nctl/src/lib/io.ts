import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export type LogFormat = 'text' | 'ndjson';

export interface StructuredEvent {
  ts: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  event: string;
  [key: string]: unknown;
}

export interface IoStreams {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  isTTY: boolean;
  isColorEnabled: boolean;
  logFormat: LogFormat;
  spinner: (text: string) => Ora;
  /**
   * Emit a structured event. In `text` mode (default), renders to a friendly
   * stderr line using the optional `text` argument. In `ndjson` mode, emits
   * a single JSON line with the event payload — agent consumers parse this.
   *
   * Set log format via N8NCTL_LOG_FORMAT=ndjson or --log-format=ndjson.
   */
  event: (eventName: string, payload?: Record<string, unknown>, text?: string) => void;
}

export type ColorSetting = 'auto' | 'always' | 'never';

export function createIoStreams(
  logFormatOverride?: LogFormat,
  colorSetting?: ColorSetting,
): IoStreams {
  const stdoutTTY = Boolean(process.stdout.isTTY);
  const noColor = 'NO_COLOR' in process.env || process.env.NO_COLOR === '1';
  const forceColor = process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === 'true';
  // Precedence (contract §6): NO_COLOR/FORCE_COLOR env > config settings.color >
  // TTY auto-detect. NO_COLOR is a hard override-off; FORCE_COLOR override-on.
  const isColorEnabled = noColor
    ? false
    : forceColor
      ? true
      : colorSetting === 'always'
        ? true
        : colorSetting === 'never'
          ? false
          : stdoutTTY;

  if (!isColorEnabled) {
    chalk.level = 0;
  }

  const logFormat: LogFormat =
    logFormatOverride ?? (process.env.N8NCTL_LOG_FORMAT === 'ndjson' ? 'ndjson' : 'text');

  const event = (
    eventName: string,
    payload: Record<string, unknown> = {},
    text?: string,
  ): void => {
    if (logFormat === 'ndjson') {
      const record: StructuredEvent = {
        ts: new Date().toISOString(),
        level: (payload.level as StructuredEvent['level']) ?? 'info',
        event: eventName,
        ...payload,
      };
      process.stderr.write(JSON.stringify(record) + '\n');
    } else if (text) {
      process.stderr.write(text + (text.endsWith('\n') ? '' : '\n'));
    }
  };

  return {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    isTTY: stdoutTTY,
    isColorEnabled,
    logFormat,
    spinner: (text: string) =>
      ora({
        text,
        // Suppress spinners in NDJSON mode — they emit rewriting characters
        // that pollute the JSON event stream when stderr is captured.
        stream: process.stderr,
        isEnabled: stdoutTTY && logFormat !== 'ndjson',
      }),
    event,
  };
}

export const c = {
  bold: (s: string) => chalk.bold(s),
  dim: (s: string) => chalk.dim(s),
  green: (s: string) => chalk.green(s),
  red: (s: string) => chalk.red(s),
  yellow: (s: string) => chalk.yellow(s),
  blue: (s: string) => chalk.blue(s),
  cyan: (s: string) => chalk.cyan(s),
  gray: (s: string) => chalk.gray(s),
};
