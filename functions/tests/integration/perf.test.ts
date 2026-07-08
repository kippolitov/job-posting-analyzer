import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import {
  startCertsStub,
  stopCertsStub,
  signTestIdToken,
  TEST_CLIENT_ID,
} from "../helpers/testTokens";
import { withAuth } from "../../src/services/auth";
import { jobsCollectionHandler } from "../../src/jobs/index";
import { ensureTable } from "../../src/services/tablesService";
import { SAVED_JOBS_SOFT_CAP } from "../../src/services/savedJobsRepository";
import { fillPartitionForTests } from "../helpers/savedJobsSeeder";

/**
 * Performance budgets from plan.md (T044), measured against Azurite + the
 * local certs stub: auth middleware overhead ≤ 100 ms p95 warm; listing a
 * 1,000-record library ≤ 1.5 s p95. Results are logged so they can be
 * recorded in plan.md Performance Goals.
 */

const RUNS = 40;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function makeContext(): InvocationContext {
  return { log: () => {}, error: () => {}, warn: () => {} } as unknown as InvocationContext;
}

function makeRequest(token: string): HttpRequest {
  return {
    method: "GET",
    params: {},
    query: new URLSearchParams(),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? `Bearer ${token}` : null,
    },
  } as unknown as HttpRequest;
}

describe("performance budgets (Azurite-backed)", () => {
  beforeAll(async () => {
    process.env.GOOGLE_OAUTH_CERTS_URL = await startCertsStub();
    process.env.GOOGLE_OAUTH_CLIENT_ID = TEST_CLIENT_ID;
    process.env.REQUIRE_AUTH = "true";
  });

  afterAll(async () => {
    await stopCertsStub();
    delete process.env.GOOGLE_OAUTH_CERTS_URL;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.REQUIRE_AUTH;
  });

  it("auth middleware overhead is ≤ 100 ms p95 warm", async () => {
    const email = `${randomUUID()}@example.com`;
    const allowedUsers = await ensureTable("AllowedUsers");
    await allowedUsers.createEntity({
      partitionKey: "AllowedUser",
      rowKey: email,
      addedAt: new Date().toISOString(),
    });
    const token = signTestIdToken({ email, sub: `sub-${randomUUID()}` });

    // The handler is a no-op, so the measured time is middleware-only:
    // token verification (offline after warm-up) + the allowlist point read.
    const noop = withAuth(() => Promise.resolve({ status: 200 }));
    const context = makeContext();

    // Warm-up: certs fetch + table client init + sub recording.
    await noop(makeRequest(token), context);

    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const res = await noop(makeRequest(token), context);
      samples.push(performance.now() - start);
      expect(res.status).toBe(200);
    }
    const p95Ms = p95(samples);
    console.log(`auth middleware warm p95: ${p95Ms.toFixed(2)} ms over ${RUNS} runs`);
    expect(p95Ms).toBeLessThanOrEqual(100);
  }, 60_000);

  it("listing a 1,000-record library is ≤ 1.5 s p95", async () => {
    const email = `${randomUUID()}@example.com`;
    const sub = `sub-${randomUUID()}`;
    const allowedUsers = await ensureTable("AllowedUsers");
    await allowedUsers.createEntity({
      partitionKey: "AllowedUser",
      rowKey: email,
      addedAt: new Date().toISOString(),
    });
    await fillPartitionForTests(sub, SAVED_JOBS_SOFT_CAP);
    const token = signTestIdToken({ email, sub });

    const list = withAuth(jobsCollectionHandler);
    const context = makeContext();
    await list(makeRequest(token), context); // warm-up

    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const res = await list(makeRequest(token), context);
      samples.push(performance.now() - start);
      expect(res.status).toBe(200);
      expect((res.jsonBody as { jobs: unknown[] }).jobs).toHaveLength(
        SAVED_JOBS_SOFT_CAP
      );
    }
    const p95Ms = p95(samples);
    console.log(
      `1,000-record list p95: ${p95Ms.toFixed(2)} ms over 10 runs (incl. auth)`
    );
    expect(p95Ms).toBeLessThanOrEqual(1_500);
  }, 120_000);
});
