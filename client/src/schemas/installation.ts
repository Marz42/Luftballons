/**
 * Installation identity (IMPLEMENTATION §26).
 * Phase 1: local UUID only — token separation is Phase 5.
 */

export interface InstallationIdentity {
  installationId: string;
  /** Reserved for user-facing label (Office-PC-A, …). Optional in Phase 1. */
  displayName?: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

const STORAGE_KEY = "luftballons.installation";

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `inst-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseIdentity(raw: string): InstallationIdentity | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "installationId" in parsed &&
      typeof (parsed as InstallationIdentity).installationId === "string" &&
      "createdAt" in parsed &&
      typeof (parsed as InstallationIdentity).createdAt === "string"
    ) {
      const identity = parsed as InstallationIdentity;
      const result: InstallationIdentity = {
        installationId: identity.installationId,
        createdAt: identity.createdAt,
      };
      if (identity.displayName !== undefined) {
        result.displayName = identity.displayName;
      }
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * First run generates a UUID and persists it locally.
 * Subsequent calls return the same identity.
 */
export function getOrCreateInstallation(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): InstallationIdentity {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing) {
    const parsed = parseIdentity(existing);
    if (parsed) {
      return parsed;
    }
  }
  const identity: InstallationIdentity = {
    installationId: newUuid(),
    createdAt: new Date().toISOString(),
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

/**
 * Persist installation identity (e.g. after server register replaces local UUID).
 */
export function setInstallation(
  identity: InstallationIdentity,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

/** Test helper — clear persisted installation. */
export function clearInstallation(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(STORAGE_KEY);
}
