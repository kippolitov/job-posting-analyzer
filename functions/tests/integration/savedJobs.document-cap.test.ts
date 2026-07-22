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
import { jobsItemHandler } from "../../src/jobs/index";
import { fillPartitionForTests } from "../helpers/savedJobsSeeder";
import { SAVED_JOBS_SOFT_CAP } from "../../src/services/savedJobsRepository";
import type { SavedJobPayload } from "../../src/models/user";

const jobsItem = withAuth(jobsItemHandler);

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function makeContext(): InvocationContext {
  return { log: () => {}, error: () => {}, warn: () => {} } as unknown as InvocationContext;
}

function makeRequest(options: {
  method: string;
  token: string;
  body?: unknown;
  params?: Record<string, string>;
}): HttpRequest {
  return {
    method: options.method,
    params: options.params ?? {},
    query: new URLSearchParams(),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? `Bearer ${options.token}` : null,
    },
    json: () =>
      options.body === undefined
        ? Promise.reject(new Error("no body"))
        : Promise.resolve(options.body),
  } as unknown as HttpRequest;
}

function makeTestUser(): { email: string; sub: string; token: string } {
  const email = `${randomUUID()}@example.com`;
  const sub = `sub-${randomUUID()}`;
  return { email, sub, token: signTestIdToken({ email, sub }) };
}

function docCanonicalUrl(): string {
  return `doc:${sha256Hex(`extracted-${randomUUID()}`)}`;
}

function makeDocumentJobBody(overrides: Partial<SavedJobPayload> = {}): SavedJobPayload {
  const canonicalUrl = overrides.canonicalUrl ?? docCanonicalUrl();
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: "",
    source: "document",
    filename: "job-description.pdf",
    analysis: {
      isJobPosting: true,
      title: "Senior Engineer",
      company: "Acme",
      location: null,
      arrangement: "remote",
      arrangementConfidence: "explicit",
      arrangementEvidence: null,
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "senior",
      techStack: [],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-21T00:00:00.000Z",
    },
    status: "interested",
    notes: "",
    savedAt: "2026-07-21T00:01:00.000Z",
    updatedAt: "2026-07-21T00:01:00.000Z",
    ...overrides,
  } as SavedJobPayload;
}

describe("saved-jobs document-source cap (data-model.md §2.1, FR-024, US5 scenario 2)", () => {
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

  it(
    "saving a document-sourced row at the tier cap returns 409 LIBRARY_FULL",
    async () => {
      const user = makeTestUser();
      await fillPartitionForTests(user.sub, SAVED_JOBS_SOFT_CAP);

      const job = makeDocumentJobBody();
      const res = await jobsItem(
        makeRequest({
          method: "PUT",
          token: user.token,
          body: job,
          params: { key: sha256Hex(job.canonicalUrl) },
        }),
        makeContext()
      );

      expect(res.status).toBe(409);
      expect(res.jsonBody).toMatchObject({ error: { code: "LIBRARY_FULL" } });
    },
    120_000
  );

  it(
    "an over-cap library stays read-only-for-additions: updates/deletes on an existing document row still succeed",
    async () => {
      const user = makeTestUser();
      const job = makeDocumentJobBody();
      const key = sha256Hex(job.canonicalUrl);

      // Save the document row first, while under cap...
      const firstSave = await jobsItem(
        makeRequest({ method: "PUT", token: user.token, body: job, params: { key } }),
        makeContext()
      );
      expect(firstSave.status).toBe(200);

      // ...then fill the rest of the partition to the cap.
      await fillPartitionForTests(user.sub, SAVED_JOBS_SOFT_CAP - 1);

      // A PATCH on the existing document row (not a new row) still succeeds.
      const patch = await jobsItem(
        {
          method: "PATCH",
          params: { key },
          query: new URLSearchParams(),
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "authorization" ? `Bearer ${user.token}` : null,
          },
          json: () => Promise.resolve({ status: "applied" }),
        } as unknown as HttpRequest,
        makeContext()
      );
      expect(patch.status).toBe(200);
      expect((patch.jsonBody as SavedJobPayload).status).toBe("applied");

      // A brand-new row (document-sourced) is refused at the cap.
      const newJob = makeDocumentJobBody();
      const newKey = sha256Hex(newJob.canonicalUrl);
      const res = await jobsItem(
        makeRequest({ method: "PUT", token: user.token, body: newJob, params: { key: newKey } }),
        makeContext()
      );
      expect(res.status).toBe(409);
    },
    120_000
  );
});
