import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import {
  startCertsStub,
  stopCertsStub,
  signTestIdToken,
  TEST_CLIENT_ID,
} from "../helpers/testTokens";
import { withAuth } from "../../src/services/auth";
import { profileHandler } from "../../src/profile/index";
import {
  jobsCollectionHandler,
  jobsItemHandler,
  jobsExportHandler,
  jobsPruneHandler,
} from "../../src/jobs/index";
import { ensureTable } from "../../src/services/tablesService";
import type { SavedJobPayload } from "../../src/models/user";

const profile = withAuth(profileHandler);
const jobsCollection = withAuth(jobsCollectionHandler);
const jobsItem = withAuth(jobsItemHandler);
const jobsExport = withAuth(jobsExportHandler);
const jobsPrune = withAuth(jobsPruneHandler);

interface TestUser {
  email: string;
  sub: string;
  token: string;
}

async function makeAllowlistedUser(): Promise<TestUser> {
  const email = `${randomUUID()}@example.com`;
  const sub = `sub-${randomUUID()}`;
  const client = await ensureTable("AllowedUsers");
  await client.createEntity({
    partitionKey: "AllowedUser",
    rowKey: email,
    addedAt: new Date().toISOString(),
  });
  return { email, sub, token: signTestIdToken({ email, sub }) };
}

function makeContext(): InvocationContext {
  return {
    log: () => {},
    error: () => {},
    warn: () => {},
  } as unknown as InvocationContext;
}

function makeRequest(options: {
  method: string;
  token?: string;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}): HttpRequest {
  return {
    method: options.method,
    params: options.params ?? {},
    query: new URLSearchParams(options.query ?? {}),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" && options.token
          ? `Bearer ${options.token}`
          : null,
    },
    json: () =>
      options.body === undefined
        ? Promise.reject(new Error("no body"))
        : Promise.resolve(options.body),
    text: () =>
      Promise.resolve(options.body === undefined ? "" : JSON.stringify(options.body)),
  } as unknown as HttpRequest;
}

function keyOf(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}

function makeJobBody(overrides: Partial<SavedJobPayload> = {}): SavedJobPayload {
  const canonicalUrl =
    overrides.canonicalUrl ?? `https://example.com/jobs/${randomUUID()}`;
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    analysis: {
      isJobPosting: true,
      title: "Senior Engineer",
      company: "Acme",
      location: "Remote",
      arrangement: "remote",
      arrangementConfidence: "explicit",
      arrangementEvidence: "fully remote",
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "senior",
      techStack: ["TypeScript"],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-04T12:00:04Z",
    },
    status: "interested",
    notes: "",
    savedAt: "2026-07-04T12:01:00.000Z",
    updatedAt: "2026-07-04T12:01:00.000Z",
    ...overrides,
  } as SavedJobPayload;
}

describe("storage API endpoints (integration: certs stub + Azurite)", () => {
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

  describe("profile routes", () => {
    it("GET returns 404 PROFILE_NOT_FOUND before any profile exists", async () => {
      const user = await makeAllowlistedUser();
      const res = await profile(
        makeRequest({ method: "GET", token: user.token }),
        makeContext()
      );
      expect(res.status).toBe(404);
      expect(res.jsonBody).toMatchObject({ error: { code: "PROFILE_NOT_FOUND" } });
    });

    it("PUT stores and GET returns the normalized profile", async () => {
      const user = await makeAllowlistedUser();
      const put = await profile(
        makeRequest({
          method: "PUT",
          token: user.token,
          body: { text: "Engineer", dealbreakers: [" no crypto ", ""] },
        }),
        makeContext()
      );
      expect(put.status).toBe(200);
      expect(put.jsonBody).toMatchObject({
        text: "Engineer",
        dealbreakers: ["no crypto"],
      });

      const get = await profile(
        makeRequest({ method: "GET", token: user.token }),
        makeContext()
      );
      expect(get.status).toBe(200);
      expect(get.jsonBody).toMatchObject({ text: "Engineer" });
    });

    it("PUT rejects malformed bodies with 400 INVALID_REQUEST", async () => {
      const user = await makeAllowlistedUser();
      const res = await profile(
        makeRequest({ method: "PUT", token: user.token, body: { nope: 1 } }),
        makeContext()
      );
      expect(res.status).toBe(400);
      expect(res.jsonBody).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    });

    it("DELETE returns 204 and is idempotent", async () => {
      const user = await makeAllowlistedUser();
      await profile(
        makeRequest({
          method: "PUT",
          token: user.token,
          body: { text: "x", dealbreakers: [] },
        }),
        makeContext()
      );
      const first = await profile(
        makeRequest({ method: "DELETE", token: user.token }),
        makeContext()
      );
      expect(first.status).toBe(204);
      const second = await profile(
        makeRequest({ method: "DELETE", token: user.token }),
        makeContext()
      );
      expect(second.status).toBe(204);
    });
  });

  describe("jobs routes", () => {
    it("PUT saves, GET item returns it, GET list includes it", async () => {
      const user = await makeAllowlistedUser();
      const job = makeJobBody();
      const key = keyOf(job.canonicalUrl);

      const put = await jobsItem(
        makeRequest({ method: "PUT", token: user.token, body: job, params: { key } }),
        makeContext()
      );
      expect(put.status).toBe(200);

      const get = await jobsItem(
        makeRequest({ method: "GET", token: user.token, params: { key } }),
        makeContext()
      );
      expect(get.status).toBe(200);
      expect(get.jsonBody).toMatchObject({ canonicalUrl: job.canonicalUrl });

      const list = await jobsCollection(
        makeRequest({ method: "GET", token: user.token }),
        makeContext()
      );
      expect(list.status).toBe(200);
      expect(
        (list.jsonBody as { jobs: SavedJobPayload[] }).jobs.map(
          (j) => j.canonicalUrl
        )
      ).toContain(job.canonicalUrl);
    });

    it("GET list rejects unknown filter values with 400", async () => {
      const user = await makeAllowlistedUser();
      const res = await jobsCollection(
        makeRequest({
          method: "GET",
          token: user.token,
          query: { arrangement: "moon-office" },
        }),
        makeContext()
      );
      expect(res.status).toBe(400);
      expect(res.jsonBody).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    });

    it("GET item returns 404 JOB_NOT_FOUND for a missing key", async () => {
      const user = await makeAllowlistedUser();
      const res = await jobsItem(
        makeRequest({
          method: "GET",
          token: user.token,
          params: { key: keyOf("https://missing.example/j") },
        }),
        makeContext()
      );
      expect(res.status).toBe(404);
      expect(res.jsonBody).toMatchObject({ error: { code: "JOB_NOT_FOUND" } });
    });

    it("PUT rejects key/canonicalUrl mismatches with 400", async () => {
      const user = await makeAllowlistedUser();
      const job = makeJobBody();
      const res = await jobsItem(
        makeRequest({
          method: "PUT",
          token: user.token,
          body: job,
          params: { key: keyOf("https://different.example/j") },
        }),
        makeContext()
      );
      expect(res.status).toBe(400);
    });

    it("PUT rejects notes above 10,000 chars with 400", async () => {
      const user = await makeAllowlistedUser();
      const job = makeJobBody({ notes: "x".repeat(10_001) });
      const res = await jobsItem(
        makeRequest({
          method: "PUT",
          token: user.token,
          body: job,
          params: { key: keyOf(job.canonicalUrl) },
        }),
        makeContext()
      );
      expect(res.status).toBe(400);
    });

    it("PATCH updates status/notes, 404s on missing, 400s on immutable-field changes", async () => {
      const user = await makeAllowlistedUser();
      const job = makeJobBody();
      const key = keyOf(job.canonicalUrl);
      await jobsItem(
        makeRequest({ method: "PUT", token: user.token, body: job, params: { key } }),
        makeContext()
      );

      const patch = await jobsItem(
        makeRequest({
          method: "PATCH",
          token: user.token,
          body: { status: "applied", notes: "sent CV" },
          params: { key },
        }),
        makeContext()
      );
      expect(patch.status).toBe(200);
      expect(patch.jsonBody).toMatchObject({ status: "applied", notes: "sent CV" });

      const missing = await jobsItem(
        makeRequest({
          method: "PATCH",
          token: user.token,
          body: { status: "applied" },
          params: { key: keyOf("https://missing.example/x") },
        }),
        makeContext()
      );
      expect(missing.status).toBe(404);

      const immutable = await jobsItem(
        makeRequest({
          method: "PATCH",
          token: user.token,
          body: { savedAt: "2099-01-01T00:00:00.000Z" },
          params: { key },
        }),
        makeContext()
      );
      expect(immutable.status).toBe(400);
    });

    it("DELETE returns 204 and is idempotent", async () => {
      const user = await makeAllowlistedUser();
      const job = makeJobBody();
      const key = keyOf(job.canonicalUrl);
      await jobsItem(
        makeRequest({ method: "PUT", token: user.token, body: job, params: { key } }),
        makeContext()
      );
      const first = await jobsItem(
        makeRequest({ method: "DELETE", token: user.token, params: { key } }),
        makeContext()
      );
      expect(first.status).toBe(204);
      const second = await jobsItem(
        makeRequest({ method: "DELETE", token: user.token, params: { key } }),
        makeContext()
      );
      expect(second.status).toBe(204);
    });

    it("PUT returns 409 LIBRARY_FULL for a new row at the cap", async () => {
      const user = await makeAllowlistedUser();
      const { fillPartitionForTests } = await import("../helpers/savedJobsSeeder");
      const { SAVED_JOBS_SOFT_CAP } = await import(
        "../../src/services/savedJobsRepository"
      );
      await fillPartitionForTests(user.sub, SAVED_JOBS_SOFT_CAP);

      const job = makeJobBody();
      const res = await jobsItem(
        makeRequest({
          method: "PUT",
          token: user.token,
          body: job,
          params: { key: keyOf(job.canonicalUrl) },
        }),
        makeContext()
      );
      expect(res.status).toBe(409);
      expect(res.jsonBody).toMatchObject({ error: { code: "LIBRARY_FULL" } });
    }, 120_000);

    it("export returns the byte-exact local format with Content-Disposition", async () => {
      const user = await makeAllowlistedUser();
      const job = makeJobBody();
      await jobsItem(
        makeRequest({
          method: "PUT",
          token: user.token,
          body: job,
          params: { key: keyOf(job.canonicalUrl) },
        }),
        makeContext()
      );

      const res = await jobsExport(
        makeRequest({ method: "GET", token: user.token }),
        makeContext()
      );
      expect(res.status).toBe(200);
      const headers = res.headers as Record<string, string>;
      expect(headers["Content-Disposition"]).toBe(
        'attachment; filename="saved-jobs.json"'
      );
      const body = res.body as string;
      const parsed = JSON.parse(body) as {
        schemaVersion: number;
        exportedAt: string;
        jobs: SavedJobPayload[];
      };
      // Byte-compatible with the existing local exportAll (2-space indent).
      expect(body).toBe(JSON.stringify(parsed, null, 2));
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.jobs.map((j) => j.canonicalUrl)).toContain(job.canonicalUrl);
    });

    it("prune deletes oldest archived entries and validates count", async () => {
      const user = await makeAllowlistedUser();
      const archived = makeJobBody({ status: "archived" });
      await jobsItem(
        makeRequest({
          method: "PUT",
          token: user.token,
          body: archived,
          params: { key: keyOf(archived.canonicalUrl) },
        }),
        makeContext()
      );

      const bad = await jobsPrune(
        makeRequest({ method: "POST", token: user.token, body: { count: 0 } }),
        makeContext()
      );
      expect(bad.status).toBe(400);

      const res = await jobsPrune(
        makeRequest({ method: "POST", token: user.token, body: { count: 5 } }),
        makeContext()
      );
      expect(res.status).toBe(200);
      expect(res.jsonBody).toEqual({ pruned: 1 });
    });
  });

  describe("shared endpoint edge paths", () => {
    it("answers OPTIONS preflight without auth on every route", async () => {
      for (const handler of [profile, jobsCollection, jobsExport, jobsPrune]) {
        const res = await handler(makeRequest({ method: "OPTIONS" }), makeContext());
        expect(res.status).toBe(204);
      }
      const item = await jobsItem(
        makeRequest({ method: "OPTIONS", params: { key: "x" } }),
        makeContext()
      );
      expect(item.status).toBe(204);
    });

    it("rejects malformed job keys and non-JSON bodies with 400", async () => {
      const user = await makeAllowlistedUser();
      const badKey = await jobsItem(
        makeRequest({ method: "GET", token: user.token, params: { key: "not-a-sha" } }),
        makeContext()
      );
      expect(badKey.status).toBe(400);

      const key = keyOf("https://a.example/x");
      const noJsonPut = await jobsItem(
        makeRequest({ method: "PUT", token: user.token, params: { key } }),
        makeContext()
      );
      expect(noJsonPut.status).toBe(400);

      const noJsonPatch = await jobsItem(
        makeRequest({ method: "PATCH", token: user.token, params: { key } }),
        makeContext()
      );
      expect(noJsonPatch.status).toBe(400);

      const noJsonPrune = await jobsPrune(
        makeRequest({ method: "POST", token: user.token }),
        makeContext()
      );
      expect(noJsonPrune.status).toBe(400);

      const noJsonProfile = await profile(
        makeRequest({ method: "PUT", token: user.token }),
        makeContext()
      );
      expect(noJsonProfile.status).toBe(400);
    });

    it("returns 405 for unsupported methods", async () => {
      const user = await makeAllowlistedUser();
      const res = await profile(
        makeRequest({ method: "POST", token: user.token, body: {} }),
        makeContext()
      );
      expect(res.status).toBe(405);

      const item = await jobsItem(
        makeRequest({
          method: "POST",
          token: user.token,
          body: {},
          params: { key: keyOf("https://a.example/x") },
        }),
        makeContext()
      );
      expect(item.status).toBe(405);
    });
  });

  describe("cross-user isolation (SC-003)", () => {
    it("two subs see zero of each other's data", async () => {
      const userA = await makeAllowlistedUser();
      const userB = await makeAllowlistedUser();
      const job = makeJobBody();
      const key = keyOf(job.canonicalUrl);

      await profile(
        makeRequest({
          method: "PUT",
          token: userA.token,
          body: { text: "A's secret profile", dealbreakers: [] },
        }),
        makeContext()
      );
      await jobsItem(
        makeRequest({ method: "PUT", token: userA.token, body: job, params: { key } }),
        makeContext()
      );

      const bProfile = await profile(
        makeRequest({ method: "GET", token: userB.token }),
        makeContext()
      );
      expect(bProfile.status).toBe(404);

      const bJob = await jobsItem(
        makeRequest({ method: "GET", token: userB.token, params: { key } }),
        makeContext()
      );
      expect(bJob.status).toBe(404);

      const bList = await jobsCollection(
        makeRequest({ method: "GET", token: userB.token }),
        makeContext()
      );
      expect((bList.jsonBody as { jobs: unknown[] }).jobs).toEqual([]);

      const bExport = await jobsExport(
        makeRequest({ method: "GET", token: userB.token }),
        makeContext()
      );
      expect(
        (JSON.parse(bExport.body as string) as { jobs: unknown[] }).jobs
      ).toEqual([]);
    });
  });

  describe("allowlist-removal data retention (FR-013)", () => {
    it("removal revokes access but retains data; re-adding restores it", async () => {
      const user = await makeAllowlistedUser();
      const job = makeJobBody();
      const key = keyOf(job.canonicalUrl);
      await jobsItem(
        makeRequest({ method: "PUT", token: user.token, body: job, params: { key } }),
        makeContext()
      );

      const allowedUsers = await ensureTable("AllowedUsers");
      await allowedUsers.deleteEntity("AllowedUser", user.email);

      const denied = await jobsItem(
        makeRequest({ method: "GET", token: user.token, params: { key } }),
        makeContext()
      );
      expect(denied.status).toBe(403);

      await allowedUsers.createEntity({
        partitionKey: "AllowedUser",
        rowKey: user.email,
        addedAt: new Date().toISOString(),
      });

      const restored = await jobsItem(
        makeRequest({ method: "GET", token: user.token, params: { key } }),
        makeContext()
      );
      expect(restored.status).toBe(200);
      expect(restored.jsonBody).toMatchObject({ canonicalUrl: job.canonicalUrl });
    });
  });
});
