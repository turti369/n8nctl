import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../errors.js';

/**
 * Rollback target selection. Pure file-system logic, no API calls — the
 * command wraps it. Ordering contract (plan dt-r1-02): the safety snapshot
 * taken at rollback time must NEVER be selectable as the rollback target,
 * and nothing is restored before the diff + confirm gate.
 */

export interface RollbackTarget {
  /** Absolute path of the chosen backup file. */
  file: string;
  /** mtime of the chosen file (shown to the user before confirm). */
  mtime: Date;
  /** Other candidates that were considered (newest first). */
  candidates: string[];
}

/** Matches files produced by `workflow backup` / pre-rollback snapshots: <slug>_<id>_<ts>.json */
export function isBackupForWorkflow(fileName: string, workflowId: string): boolean {
  return fileName.endsWith('.json') && fileName.includes(`_${workflowId}_`);
}

export async function selectRollbackTarget(
  backupDir: string,
  workflowId: string,
  opts: { to?: string; exclude?: string[] } = {},
): Promise<RollbackTarget> {
  if (opts.to) {
    const abs = path.resolve(opts.to);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat?.isFile()) {
      throw new ValidationError(`Rollback target ${abs} does not exist or is not a file`);
    }
    return { file: abs, mtime: stat.mtime, candidates: [abs] };
  }

  const absDir = path.resolve(backupDir);
  const entries = await fs.readdir(absDir).catch(() => {
    throw new ValidationError(
      `Backup directory ${absDir} not found`,
      'Pass --backup-dir <dir> or --to <file>, or create a backup first: n8nctl workflow backup <id>',
    );
  });

  const excluded = new Set((opts.exclude ?? []).map((p) => path.resolve(p)));
  const stats: Array<{ file: string; mtime: Date }> = [];
  for (const name of entries) {
    if (!isBackupForWorkflow(name, workflowId)) continue;
    const full = path.resolve(absDir, name);
    if (excluded.has(full)) continue;
    const st = await fs.stat(full).catch(() => null);
    if (st?.isFile()) stats.push({ file: full, mtime: st.mtime });
  }

  if (stats.length === 0) {
    throw new ValidationError(
      `No backups for workflow ${workflowId} in ${absDir}`,
      'Create one first (n8nctl workflow backup <id>) or pass --to <file>.',
    );
  }

  stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return {
    file: stats[0].file,
    mtime: stats[0].mtime,
    candidates: stats.map((s) => s.file),
  };
}
