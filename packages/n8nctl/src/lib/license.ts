import { ApiError } from './errors.js';

/**
 * Variables / Projects / Source Control are licensed n8n features. On
 * community edition the Public API answers 403 (or 404 on very old
 * versions) — rethrow with an actionable hint instead of a bare HTTP error.
 */
export function rethrowWithLicenseHint(err: unknown, feature: string): never {
  if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
    throw new ApiError(
      `${feature} API not available on this instance (HTTP ${err.status})`,
      err.status,
      err.body,
      `${feature} is a licensed n8n feature (paid plan). Check the plan or run \`n8nctl doctor\` for a license-feature probe.`,
    );
  }
  throw err as Error;
}
