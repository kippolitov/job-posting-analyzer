import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import {
  jobStorage,
  LibraryFullError,
  SAVED_JOBS_SOFT_CAP,
} from "../../services/jobStorage";
import {
  getIdToken,
  markNotAuthorized,
  signInSilently,
  signOut,
} from "../../services/auth/authService";
import {
  createFakeStorageApi,
  stubApiBaseGlobals,
} from "./helpers/mswStorageServer";
import type { SavedJob } from "../../types/job";

vi.mock("../../services/auth/authService", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-id-token"),
  signInSilently: vi.fn().mockResolvedValue(null),
  signOut: vi.fn().mockResolvedValue(undefined),
  markNotAuthorized: vi.fn().mockResolvedValue(undefined),
}));

const api = createFakeStorageApi();

function makeJob(overrides: Partial<SavedJob> = {}): SavedJob {
  const canonicalUrl = overrides.canonicalUrl ?? "https://a.example/jobs/1";
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    analysis: {
      isJobPosting: true,
      title: "Engineer",
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
      analyzedAt: "2026-07-04T12:00:04Z",
    },
    status: "interested",
    notes: "",
    savedAt: "2026-07-04T12:01:00.000Z",
    updatedAt: "2026-07-04T12:01:00.000Z",
    ...overrides,
  };
}

beforeAll(() => api.server.listen({ onUnhandledRequest: "error" }));
afterAll(() => api.server.close());

beforeEach(() => {
  api.reset();
  api.server.events.removeAllListeners();
  stubApiBaseGlobals();
  vi.mocked(getIdToken).mockReset().mockResolvedValue("test-id-token");
  vi.mocked(signInSilently).mockReset().mockResolvedValue(null);
  vi.mocked(signOut).mockClear();
  vi.mocked(markNotAuthorized).mockClear();
});

describe("jobStorage (fetch-backed JobRepository, contracts/storage-api.md)", () => {
  it("exposes the unchanged JobRepository interface", () => {
    expect(Object.keys(jobStorage).sort()).toEqual(
      ["exportAll", "get", "list", "pruneArchived", "remove", "save", "update"].sort()
    );
    expect(SAVED_JOBS_SOFT_CAP).toBe(1_000);
  });

  it("save PUTs to /jobs/{sha256} and get returns the stored record", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    const key = await api.seededKey(job.canonicalUrl);
    expect(api.jobs.has(key)).toBe(true);

    const loaded = await jobStorage.get(job.canonicalUrl);
    expect(loaded).not.toBeNull();
    expect(loaded!.canonicalUrl).toBe(job.canonicalUrl);
    expect(loaded!.analysis).toEqual(job.analysis);
  });

  it("get returns null on 404", async () => {
    await expect(jobStorage.get("https://missing.example/j")).resolves.toBeNull();
  });

  it("list forwards arrangement/status filters and preserves server order", async () => {
    const remote = makeJob({ canonicalUrl: "https://a.example/1" });
    const onsite = makeJob({ canonicalUrl: "https://a.example/2" });
    onsite.analysis = { ...onsite.analysis, arrangement: "onsite" };
    await jobStorage.save(remote);
    await jobStorage.save(onsite);

    const all = await jobStorage.list();
    expect(all).toHaveLength(2);
    const remoteOnly = await jobStorage.list({ arrangement: "remote" });
    expect(remoteOnly.map((j) => j.canonicalUrl)).toEqual(["https://a.example/1"]);
  });

  it("save maps 409 LIBRARY_FULL to LibraryFullError", async () => {
    api.setCap(0);
    await expect(jobStorage.save(makeJob())).rejects.toBeInstanceOf(
      LibraryFullError
    );
  });

  it("update PATCHes status/notes and is a no-op on a missing record", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    await jobStorage.update(job.canonicalUrl, {
      status: "applied",
      notes: "sent CV",
    });
    const stored = await jobStorage.get(job.canonicalUrl);
    expect(stored!.status).toBe("applied");
    expect(stored!.notes).toBe("sent CV");

    await expect(
      jobStorage.update("https://missing.example/j", { status: "ghosted" })
    ).resolves.toBeUndefined();
  });

  it("remove DELETEs the record", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    await jobStorage.remove(job.canonicalUrl);
    await expect(jobStorage.get(job.canonicalUrl)).resolves.toBeNull();
  });

  it("exportAll returns the server's byte-exact JSON export", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    const exported = await jobStorage.exportAll();
    const parsed = JSON.parse(exported) as { schemaVersion: number; jobs: SavedJob[] };
    expect(exported).toBe(JSON.stringify(parsed, null, 2));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.jobs.map((j) => j.canonicalUrl)).toEqual([job.canonicalUrl]);
  });

  it("pruneArchived POSTs the count and returns the pruned total", async () => {
    const archived = makeJob({
      canonicalUrl: "https://a.example/old",
      status: "archived",
    });
    await jobStorage.save(archived);
    await expect(jobStorage.pruneArchived(5)).resolves.toBe(1);
    await expect(jobStorage.get(archived.canonicalUrl)).resolves.toBeNull();
  });

  it("sends the Bearer token from authService with each request", async () => {
    let seenAuth: string | null = null;
    api.server.events.on("request:start", ({ request }) => {
      seenAuth = request.headers.get("authorization");
    });
    await jobStorage.list();
    expect(seenAuth).toBe("Bearer test-id-token");
  });

  it("on 401: renews once and retries; renewal failure signs out (gate)", async () => {
    api.failNext(401);
    vi.mocked(signInSilently).mockResolvedValue({
      idToken: "renewed",
      expiresAt: Date.now() + 3600_000,
      signedInAt: Date.now(),
      user: { sub: "s", email: "e@example.com" },
    });
    await expect(jobStorage.list()).resolves.toEqual([]);
    expect(signInSilently).toHaveBeenCalledTimes(1);

    api.failNext(401);
    vi.mocked(signInSilently).mockResolvedValue(null);
    await expect(jobStorage.list()).rejects.toThrow();
    expect(signOut).toHaveBeenCalled();
  });

  it("on 403: marks the session not-authorized (invitation state)", async () => {
    api.failNext(403);
    await expect(jobStorage.list()).rejects.toThrow();
    expect(markNotAuthorized).toHaveBeenCalled();
  });

  it("surfaces 5xx as a retryable failure without masking it as empty data (FR-015)", async () => {
    api.failNext(500);
    await expect(jobStorage.list()).rejects.toMatchObject({ retryable: true });
  });
});
