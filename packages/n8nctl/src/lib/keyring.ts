const SERVICE_NAME = 'n8nctl';

type KeytarModule = typeof import('keytar');

let keytarCache: KeytarModule | null | undefined;

async function loadKeytar(): Promise<KeytarModule | null> {
  if (keytarCache !== undefined) return keytarCache;
  try {
    const mod = await import('keytar');
    keytarCache = mod.default ?? mod;
    return keytarCache;
  } catch {
    keytarCache = null;
    return null;
  }
}

export async function isKeyringAvailable(): Promise<boolean> {
  const keytar = await loadKeytar();
  return keytar !== null;
}

export async function setPassword(account: string, password: string): Promise<boolean> {
  const keytar = await loadKeytar();
  if (!keytar) return false;
  try {
    await keytar.setPassword(SERVICE_NAME, account, password);
    // Verify-after-write: on Linux without libsecret, setPassword may succeed
    // but the value is never persisted. Round-trip confirms real storage.
    const roundTrip = await keytar.getPassword(SERVICE_NAME, account);
    return roundTrip === password;
  } catch {
    return false;
  }
}

export async function getPassword(account: string): Promise<string | null> {
  const keytar = await loadKeytar();
  if (!keytar) return null;
  try {
    return await keytar.getPassword(SERVICE_NAME, account);
  } catch {
    return null;
  }
}

export async function deletePassword(account: string): Promise<boolean> {
  const keytar = await loadKeytar();
  if (!keytar) return false;
  try {
    return await keytar.deletePassword(SERVICE_NAME, account);
  } catch {
    return false;
  }
}

export function keyringAccountFor(profileName: string): string {
  return `profile:${profileName}`;
}

/** Keyring account holding the n8n login password for session mode. */
export function keyringPasswordAccountFor(profileName: string): string {
  return `profile:${profileName}:password`;
}

/** Keyring account holding the cached /rest session cookie. */
export function keyringCookieAccountFor(profileName: string): string {
  return `profile:${profileName}:cookie`;
}

/**
 * Delete ALL keyring material for a profile: API key, session password, and
 * cached cookie. Unconditional + idempotent (deletePassword no-throws on a
 * missing account) so logout/remove never leave orphaned secrets behind.
 */
export async function purgeProfileSecrets(profileName: string): Promise<void> {
  await deletePassword(keyringAccountFor(profileName));
  await deletePassword(keyringPasswordAccountFor(profileName));
  await deletePassword(keyringCookieAccountFor(profileName));
}
