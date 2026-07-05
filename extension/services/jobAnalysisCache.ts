import { canonicalKey } from "../lib/canonicalUrl";
import type { JobAnalysis } from "../types/job";

const CACHE_KEY_PREFIX = "jobcache:";

export const CACHE_MAX_ENTRIES = 200;
export const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  analysis: JobAnalysis;
  cachedAt: number;
  lastAccess: number;
}

async function cacheKey(url: string): Promise<string> {
  return `${CACHE_KEY_PREFIX}${await canonicalKey(url)}`;
}

export async function getCached(url: string): Promise<JobAnalysis | null> {
  const key = await cacheKey(url);
  const data = await chrome.storage.session.get(key);
  const entry = data[key] as CacheEntry | undefined;
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    await chrome.storage.session.remove(key);
    return null;
  }

  await chrome.storage.session.set({
    [key]: { ...entry, lastAccess: Date.now() },
  });
  return entry.analysis;
}

export async function setCached(url: string, analysis: JobAnalysis): Promise<void> {
  const key = await cacheKey(url);
  const now = Date.now();

  const all = await chrome.storage.session.get(null);
  const entries = Object.entries(all).filter(
    ([existingKey]) => existingKey.startsWith(CACHE_KEY_PREFIX) && existingKey !== key
  ) as [string, CacheEntry][];

  if (entries.length >= CACHE_MAX_ENTRIES) {
    const victims = entries
      .sort(([, a], [, b]) => a.lastAccess - b.lastAccess)
      .slice(0, entries.length - CACHE_MAX_ENTRIES + 1)
      .map(([victimKey]) => victimKey);
    await chrome.storage.session.remove(victims);
  }

  await chrome.storage.session.set({
    [key]: { analysis, cachedAt: now, lastAccess: now } satisfies CacheEntry,
  });
}
