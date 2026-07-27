/**
 * `chrome.storage.local` CRUD for per-host learned selectors
 * (contracts/learned-selectors.md). A purely local contract — spec FR-033
 * requires these never leave the browser, which is why `local` and never
 * `sync`.
 *
 * Every operation degrades to a no-op on a storage failure: learned
 * selectors are an optimization, and extraction must work with the store
 * entirely unreadable (contract "Storage-unavailable behavior").
 */

export interface LearnedHostSelector {
  host: string;
  selector: string;
  learnedAt: string;
  lastUsedAt: string;
  consecutiveMisses: number;
}

/** Cap on distinct learned hosts (spec FR-030). */
const MAX_HOSTS = 200;
/** Consecutive misses before a learned selector is retired (spec FR-029). */
const MAX_CONSECUTIVE_MISSES = 3;

function storageKey(host: string): string {
  return `learned:${host}`;
}

async function readAll(): Promise<Record<string, LearnedHostSelector>> {
  try {
    const all = await chrome.storage.local.get(null);
    const result: Record<string, LearnedHostSelector> = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith("learned:")) {
        result[key] = value as LearnedHostSelector;
      }
    }
    return result;
  } catch {
    return {};
  }
}

async function get(host: string): Promise<LearnedHostSelector | null> {
  try {
    const data = await chrome.storage.local.get(storageKey(host));
    const record = data[storageKey(host)] as LearnedHostSelector | undefined;
    return record ?? null;
  } catch {
    return null;
  }
}

/**
 * Upserts and resets the miss counter. Called ONLY when the user accepts the
 * offer to reuse a region (spec FR-026b) — never as a side effect of picking
 * or selecting a region for a one-off analysis.
 */
async function put(host: string, selector: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    const record: LearnedHostSelector = {
      host,
      selector,
      learnedAt: now,
      lastUsedAt: now,
      consecutiveMisses: 0,
    };
    await chrome.storage.local.set({ [storageKey(host)]: record });
    await evictIfOverCap();
  } catch {
    // Learning is an optimization; a failed write just means this host
    // isn't learned yet, not a broken extraction.
  }
}

/** LRU eviction by lastUsedAt — a host learned long ago but used weekly outlives one learned yesterday and never revisited. */
async function evictIfOverCap(): Promise<void> {
  const all = await readAll();
  const keys = Object.keys(all);
  if (keys.length <= MAX_HOSTS) return;

  const sortedByLastUsed = keys.sort(
    (a, b) => Date.parse(all[a].lastUsedAt) - Date.parse(all[b].lastUsedAt)
  );
  const toEvict = sortedByLastUsed.slice(0, keys.length - MAX_HOSTS);
  if (toEvict.length > 0) {
    await chrome.storage.local.remove(toEvict);
  }
}

/** On successful use: refresh lastUsedAt and clear the miss counter. */
async function touch(host: string): Promise<void> {
  try {
    const record = await get(host);
    if (!record) return;
    record.lastUsedAt = new Date().toISOString();
    record.consecutiveMisses = 0;
    await chrome.storage.local.set({ [storageKey(host)]: record });
  } catch {
    // Best-effort — a failed touch just means the LRU clock is a bit stale.
  }
}

/** Increments the miss counter; retires (deletes) the record at MAX_CONSECUTIVE_MISSES. */
async function recordMiss(host: string): Promise<void> {
  try {
    const record = await get(host);
    if (!record) return;
    const consecutiveMisses = record.consecutiveMisses + 1;
    if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
      await chrome.storage.local.remove(storageKey(host));
      return;
    }
    await chrome.storage.local.set({
      [storageKey(host)]: { ...record, consecutiveMisses },
    });
  } catch {
    // Best-effort — a failed write leaves the stale record in place, which
    // just means one more miss is needed before retirement.
  }
}

async function clear(host: string): Promise<void> {
  try {
    await chrome.storage.local.remove(storageKey(host));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

async function clearAll(): Promise<void> {
  try {
    const all = await readAll();
    const keys = Object.keys(all);
    if (keys.length > 0) await chrome.storage.local.remove(keys);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** For the options page — sorted by lastUsedAt, most recently used first. */
async function list(): Promise<LearnedHostSelector[]> {
  const all = await readAll();
  return Object.values(all).sort(
    (a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt)
  );
}

export const learnedSelectors = {
  get,
  put,
  touch,
  recordMiss,
  clear,
  clearAll,
  list,
};
