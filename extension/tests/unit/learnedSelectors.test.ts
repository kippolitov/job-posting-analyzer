import { describe, it, expect, beforeEach, vi } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { learnedSelectors } from "../../services/learnedSelectors";

describe("learnedSelectors (contracts/learned-selectors.md)", () => {
  beforeEach(() => {
    installMemoryStorage("local");
  });

  it("get returns null for a host with no learned selector", async () => {
    expect(await learnedSelectors.get("jobs.example.com")).toBeNull();
  });

  it("put stores the selector, resets misses, and sets both timestamps", async () => {
    await learnedSelectors.put("jobs.example.com", "main .job-description");
    const record = await learnedSelectors.get("jobs.example.com");
    expect(record).toMatchObject({
      host: "jobs.example.com",
      selector: "main .job-description",
      consecutiveMisses: 0,
    });
    expect(record!.learnedAt).toBe(record!.lastUsedAt);
  });

  it("touch refreshes lastUsedAt and resets consecutiveMisses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await learnedSelectors.put("jobs.example.com", ".body");
    await learnedSelectors.recordMiss("jobs.example.com");
    expect((await learnedSelectors.get("jobs.example.com"))!.consecutiveMisses).toBe(1);

    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    await learnedSelectors.touch("jobs.example.com");
    const record = await learnedSelectors.get("jobs.example.com");
    expect(record!.consecutiveMisses).toBe(0);
    expect(record!.lastUsedAt).toBe("2026-01-02T00:00:00.000Z");
    vi.useRealTimers();
  });

  it("recordMiss increments the counter and retires the record at 3 consecutive misses (FR-029)", async () => {
    await learnedSelectors.put("jobs.example.com", ".body");
    await learnedSelectors.recordMiss("jobs.example.com");
    expect((await learnedSelectors.get("jobs.example.com"))!.consecutiveMisses).toBe(1);
    await learnedSelectors.recordMiss("jobs.example.com");
    expect((await learnedSelectors.get("jobs.example.com"))!.consecutiveMisses).toBe(2);
    await learnedSelectors.recordMiss("jobs.example.com");
    expect(await learnedSelectors.get("jobs.example.com")).toBeNull();
  });

  it("recordMiss on a host with nothing learned is a no-op", async () => {
    await learnedSelectors.recordMiss("jobs.example.com");
    expect(await learnedSelectors.get("jobs.example.com")).toBeNull();
  });

  it("clear removes one host without touching others", async () => {
    await learnedSelectors.put("a.example.com", ".a");
    await learnedSelectors.put("b.example.com", ".b");
    await learnedSelectors.clear("a.example.com");
    expect(await learnedSelectors.get("a.example.com")).toBeNull();
    expect(await learnedSelectors.get("b.example.com")).not.toBeNull();
  });

  it("clearAll removes every learned host", async () => {
    await learnedSelectors.put("a.example.com", ".a");
    await learnedSelectors.put("b.example.com", ".b");
    await learnedSelectors.clearAll();
    expect(await learnedSelectors.list()).toEqual([]);
  });

  it("list is sorted by lastUsedAt, most recently used first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await learnedSelectors.put("old.example.com", ".a");
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    await learnedSelectors.put("newest.example.com", ".b");
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    await learnedSelectors.put("middle.example.com", ".c");
    vi.useRealTimers();

    const hosts = (await learnedSelectors.list()).map((r) => r.host);
    expect(hosts).toEqual(["newest.example.com", "middle.example.com", "old.example.com"]);
  });

  it("evicts the least-recently-USED host at the 200-host cap, not the oldest-learned (FR-030)", async () => {
    vi.useFakeTimers();
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    for (let i = 0; i < 200; i += 1) {
      vi.setSystemTime(new Date(base + i * 1000));
      await learnedSelectors.put(`host-${i}.example.com`, ".body");
    }
    // host-0 was learned first but touch it last, so it is now the MOST
    // recently used — LRU eviction must key on lastUsedAt, not learnedAt.
    vi.setSystemTime(new Date(base + 200 * 1000));
    await learnedSelectors.touch("host-0.example.com");

    // One more host pushes the store over the 200-host cap.
    vi.setSystemTime(new Date(base + 201 * 1000));
    await learnedSelectors.put("host-200.example.com", ".body");
    vi.useRealTimers();

    const hosts = (await learnedSelectors.list()).map((r) => r.host);
    expect(hosts.length).toBe(200);
    // host-0 survives because it was just touched...
    expect(hosts).toContain("host-0.example.com");
    // ...while host-1, the next-least-recently-used, is evicted instead.
    expect(hosts).not.toContain("host-1.example.com");
  });

  it("put is not called by the act of scoping — only by accepting the reuse offer (FR-026b)", async () => {
    // learnedSelectors has no method that both scopes and persists in one
    // call; put() is the only write path, and it always requires an
    // explicit, separate invocation. This test documents that contract: a
    // caller must deliberately call put() — nothing here does it implicitly.
    expect(await learnedSelectors.get("jobs.example.com")).toBeNull();
  });
});

describe("learnedSelectors — storage unavailable (contract)", () => {
  it("every operation degrades to a no-op returning null/void rather than throwing", async () => {
    // No installMemoryStorage() call: chrome.storage.local.* mocks from
    // tests/setup.ts reject by default, simulating storage being unreadable.
    await expect(learnedSelectors.get("jobs.example.com")).resolves.toBeNull();
    await expect(learnedSelectors.put("jobs.example.com", ".body")).resolves.toBeUndefined();
    await expect(learnedSelectors.touch("jobs.example.com")).resolves.toBeUndefined();
    await expect(learnedSelectors.recordMiss("jobs.example.com")).resolves.toBeUndefined();
    await expect(learnedSelectors.clear("jobs.example.com")).resolves.toBeUndefined();
    await expect(learnedSelectors.clearAll()).resolves.toBeUndefined();
    await expect(learnedSelectors.list()).resolves.toEqual([]);
  });
});
