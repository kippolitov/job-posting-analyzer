import type { AuthenticatedUser } from "../../types/auth";
import {
  AUTH_SESSION_KEY,
  NOT_AUTHORIZED_KEY,
  getStoredAuth,
  isNotAuthorized,
} from "./authService";

/**
 * UI-facing auth snapshot. "signed-in" means a session exists locally — the
 * server is the enforcement boundary (FR-003); a stale local session simply
 * fails its next request and the gate returns.
 */

export type AuthStatus = "loading" | "signed-out" | "not-authorized" | "signed-in";

export interface AuthSnapshot {
  status: AuthStatus;
  user: AuthenticatedUser | null;
}

type Listener = (snapshot: AuthSnapshot) => void;

const listeners = new Set<Listener>();

export async function readAuthSnapshot(): Promise<AuthSnapshot> {
  if (await isNotAuthorized()) {
    return { status: "not-authorized", user: null };
  }
  const stored = await getStoredAuth();
  if (stored) {
    return { status: "signed-in", user: stored.user };
  }
  return { status: "signed-out", user: null };
}

async function broadcast(): Promise<void> {
  const snapshot = await readAuthSnapshot();
  for (const listener of listeners) listener(snapshot);
}

/** Subscribes to auth changes (storage-driven, so all surfaces stay in sync). */
export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    }
  };
}

function handleStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
): void {
  if (areaName !== "local") return;
  if (AUTH_SESSION_KEY in changes || NOT_AUTHORIZED_KEY in changes) {
    void broadcast();
  }
}
