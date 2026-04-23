import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export interface IoStreams {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  isTTY: boolean;
  isColorEnabled: boolean;
  spinner: (text: string) => Ora;
}

export function createIoStreams(): IoStreams {
  const stdoutTTY = Boolean(process.stdout.isTTY);
  const noColor = 'NO_COLOR' in process.env || process.env.NO_COLOR === '1';
  const forceColor = process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === 'true';
  const isColorEnabled = forceColor || (stdoutTTY && !noColor);

  if (!isColorEnabled) {
    chalk.level = 0;
  }

  return {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    isTTY: stdoutTTY,
    isColorEnabled,
    spinner: (text: string) =>
      ora({
        text,
        stream: process.stderr,
        isEnabled: stdoutTTY,
      }),
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
