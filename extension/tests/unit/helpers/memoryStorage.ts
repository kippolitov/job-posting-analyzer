import { vi } from "vitest";

/**
 * Installs a functional in-memory implementation behind the chrome.storage
 * area mocks from tests/setup.ts. Returns the backing map for assertions
 * and a `failNextSet` switch to simulate quota errors.
 */
export function installMemoryStorage(
  area: "local" | "session" = "local"
): { store: Map<string, unknown>; failNextSet: (error?: Error) => void } {
  const store = new Map<string, unknown>();
  let nextSetError: Error | null = null;

  const storageArea = chrome.storage[area];

  vi.mocked(storageArea.get).mockImplementation(((keys?: unknown) => {
    const result: Record<string, unknown> = {};
    if (keys === null || keys === undefined) {
      for (const [key, value] of store) result[key] = value;
    } else {
      const list = Array.isArray(keys) ? (keys as string[]) : [String(keys)];
      for (const key of list) {
        if (store.has(key)) result[key] = store.get(key);
      }
    }
    return Promise.resolve(result);
  }) as typeof storageArea.get);

  vi.mocked(storageArea.set).mockImplementation(((items: Record<string, unknown>) => {
    if (nextSetError) {
      const error = nextSetError;
      nextSetError = null;
      return Promise.reject(error);
    }
    for (const [key, value] of Object.entries(items)) store.set(key, value);
    return Promise.resolve();
  }) as typeof storageArea.set);

  vi.mocked(storageArea.remove).mockImplementation(((keys: unknown) => {
    const list = Array.isArray(keys) ? (keys as string[]) : [String(keys)];
    for (const key of list) store.delete(key);
    return Promise.resolve();
  }) as typeof storageArea.remove);

  return {
    store,
    failNextSet: (error = new Error("QUOTA_BYTES quota exceeded")) => {
      nextSetError = error;
    },
  };
}
