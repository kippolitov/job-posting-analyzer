import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";
import { saveKeyFor } from "@/lib/saveKey";
import { profileToPromptText } from "shared/types/profile";
import type { DocumentAnalysisResult, SavedJobPayload } from "@/api/types";

function makeFile(name: string, type: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

async function uploadFile(file: File) {
  const input = await screen.findByLabelText(/upload a document/i);
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.upload(input, file);
}

describe("document upload errors (contracts/analyze-document.md, FR-020/FR-023)", () => {
  const api = installFakeApi();

  it("413 FILE_TOO_LARGE renders the plain-language size error", async () => {
    seedSession();
    api.failNext("analyze-document", {
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "File exceeds the 10 MB limit.",
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    await uploadFile(makeFile("big.pdf", "application/pdf"));
    await screen.findByText(/10 MB limit/i);
  });

  it("415 UNSUPPORTED_FILE_TYPE renders the plain-language format error", async () => {
    seedSession();
    api.failNext("analyze-document", {
      status: 415,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Only .docx and .pdf files are supported.",
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    await uploadFile(makeFile("mislabeled.pdf", "application/pdf"));
    await screen.findByText(/\.docx and \.pdf/i);
  });

  it("422 FILE_NO_TEXT renders the plain-language unreadable-document error", async () => {
    seedSession();
    api.failNext("analyze-document", {
      status: 422,
      code: "FILE_NO_TEXT",
      message: "No text could be extracted from this document.",
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    await uploadFile(makeFile("scan.pdf", "application/pdf"));
    await screen.findByText(/no text could be extracted/i);
  });

  it("429 USAGE_LIMIT_REACHED renders the reset-date exhaustion state with an upgrade path", async () => {
    seedSession();
    api.failNext("analyze-document", {
      status: 429,
      code: "USAGE_LIMIT_REACHED",
      message: "You've used all 50 free analyses this month. Your allowance resets on August 1.",
      usage: { count: 50, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z", tier: "free" },
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    await uploadFile(makeFile("job.pdf", "application/pdf"));
    await screen.findByText(/resets on august 1/i);
    expect(screen.getByRole("link", { name: /upgrade/i })).toBeInTheDocument();
  });
});

const OLDER = "o".repeat(64);
const CURRENT = "c".repeat(64);
const PROFILE = {
  text: "Backend engineer.",
  dealbreakers: ["no fully on-site roles"],
  updatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
  fingerprint: CURRENT,
};

function analysisOf(title: string, fit: SavedJobPayload["analysis"]["fit"] = null) {
  return {
    isJobPosting: true,
    title,
    company: "Acme",
    location: null,
    arrangement: "remote" as const,
    arrangementConfidence: "explicit" as const,
    arrangementEvidence: null,
    daysInOffice: null,
    daysRemote: null,
    remoteRestrictions: null,
    salary: null,
    seniority: "senior" as const,
    techStack: [],
    fit,
    model: "m",
    analyzedAt: "2026-07-01T00:00:00.000Z",
  };
}

function savedDoc(canonicalUrl: string, source: "document" | "paste"): SavedJobPayload {
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: "",
    source,
    filename: source === "document" ? "job.pdf" : "",
    analysis: analysisOf("Saved Role", { score: 40, rationale: "old", profileFingerprint: OLDER }),
    status: "applied",
    notes: "keep me",
    savedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

async function resultFor(
  canonicalUrl: string,
  source: "document" | "paste",
  overrides: Partial<DocumentAnalysisResult> = {}
): Promise<DocumentAnalysisResult> {
  return {
    analysis: analysisOf("Fresh Role", { score: 77, rationale: "new", profileFingerprint: CURRENT }),
    source,
    ...(source === "document" ? { filename: "job.pdf" } : {}),
    canonicalUrl,
    saveKey: await saveKeyFor(canonicalUrl),
    usage: { count: 1, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z", tier: "free" },
    ...overrides,
  };
}

const PASTE_TEXT = "We are hiring a Software Engineer in Austin. ".repeat(12);

describe("profile gate and profileData parity (T058, T055)", () => {
  const api = installFakeApi();

  it("does not send until the profile request settles, and sends profileData with the derived profile", async () => {
    const formSet = vi.spyOn(FormData.prototype, "set");
    seedSession();
    api.setProfile(PROFILE);
    api.setDocumentResult(await resultFor("doc:one", "document"));
    // Hold the profile response open to observe the gate.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.server.use(
      http.get("http://api.test/profile", async () => {
        await held;
        return HttpResponse.json(PROFILE);
      })
    );
    window.history.pushState({}, "", "/upload");
    render(<App />);

    const input = await screen.findByLabelText(/upload a document/i);
    expect(input).toBeDisabled();
    expect(screen.getByText("Loading your profile…")).toBeInTheDocument();
    release();
    await waitFor(() => expect(input).toBeEnabled());
    expect(api.calls["analyze-document"]).toBe(0);

    await userEvent.upload(input, makeFile("job.pdf", "application/pdf"));
    await waitFor(() => expect(api.calls["analyze-document"]).toBe(1));

    const profileData = { text: PROFILE.text, dealbreakers: PROFILE.dealbreakers };
    expect(formSet).toHaveBeenCalledWith("profileData", JSON.stringify(profileData));
    expect(formSet).toHaveBeenCalledWith("profile", profileToPromptText(profileData));
    formSet.mockRestore();
    api.server.resetHandlers(); // drop the held-open profile override
  });

  it("still analyzes when the profile fetch fails, and says the fit was not scored", async () => {
    seedSession();
    api.failNext("profile", { status: 500, code: "SERVICE_ERROR", message: "boom" });
    api.setDocumentResult(await resultFor("doc:two", "document", {
      analysis: analysisOf("No Fit Role"),
    }));
    window.history.pushState({}, "", "/upload");
    render(<App />);

    const input = await screen.findByLabelText(/upload a document/i);
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.upload(input, makeFile("job.pdf", "application/pdf"));

    await screen.findByText("Fit not scored — your profile couldn’t be loaded");
  });
});

describe("document rescore (T058)", () => {
  const api = installFakeApi();

  it("shows the cost line before sending, sends rescore with the prior fingerprint, and PATCHes in place", async () => {
    const formSet = vi.spyOn(FormData.prototype, "set");
    seedSession();
    api.setProfile(PROFILE);
    api.setAccount({
      email: "u@e.c",
      tier: "free",
      usage: {
        count: 12,
        limit: 50,
        resetsAt: "2026-08-01T00:00:00.000Z",
        rescoresUsed: 3,
        rescoresLimit: 10,
      },
      subscription: null,
    });
    api.setJobs([savedDoc("doc:rescore", "document")]);
    api.setDocumentResult(await resultFor("doc:rescore", "document"));
    const key = await saveKeyFor("doc:rescore");

    window.history.pushState({}, "", `/upload?rescore=${key}`);
    render(<App />);

    await screen.findByText("Free — 7 of 10 free rescores left this month");
    expect(api.calls["analyze-document"]).toBe(0);

    const input = await screen.findByLabelText(/upload a document/i);
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.upload(input, makeFile("job.pdf", "application/pdf"));

    await screen.findByText(/Rescored and updated in your library/);
    expect(formSet).toHaveBeenCalledWith("rescore", "true");
    expect(formSet).toHaveBeenCalledWith("priorFingerprint", OLDER);
    expect(api.patches).toHaveLength(1);
    expect(api.patches[0]!.key).toBe(key);
    expect((api.patches[0]!.body.analysis as { title: string }).title).toBe("Fresh Role");
    expect(screen.queryByRole("button", { name: /save to library/i })).not.toBeInTheDocument();
    formSet.mockRestore();
  });

  it("a result with a different key is not PATCHed; it offers Save and says why", async () => {
    seedSession();
    api.setProfile(PROFILE);
    api.setJobs([savedDoc("doc:rescore", "document")]);
    api.setDocumentResult(await resultFor("doc:other", "document"));
    const key = await saveKeyFor("doc:rescore");

    window.history.pushState({}, "", `/upload?rescore=${key}`);
    render(<App />);
    const input = await screen.findByLabelText(/upload a document/i);
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.upload(input, makeFile("different.pdf", "application/pdf"));

    await screen.findByText("This didn’t match the saved posting, so it was analyzed as a new one.");
    expect(screen.getByRole("button", { name: /save to library/i })).toBeInTheDocument();
    expect(api.patches).toHaveLength(0);
  });
});

describe("Paste text option (T059, FR-027)", () => {
  const api = installFakeApi();

  it("renames the page and nav, defaults to upload and selects paste from ?mode=paste", async () => {
    seedSession();
    window.history.pushState({}, "", "/upload");
    const { unmount } = render(<App />);
    await screen.findByRole("heading", { name: "Analyze a posting" });
    expect(screen.getByRole("link", { name: "Analyze posting" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Upload a file" })).toBeChecked();
    unmount();

    window.history.pushState({}, "", "/upload?mode=paste");
    render(<App />);
    expect(await screen.findByRole("radio", { name: "Paste text" })).toBeChecked();
  });

  it("refuses a short and an over-long paste without sending", async () => {
    seedSession();
    window.history.pushState({}, "", "/upload?mode=paste");
    render(<App />);
    const box = await screen.findByLabelText("Pasted job posting");
    await waitFor(() => expect(box).toBeEnabled());

    await userEvent.type(box, "too short");
    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("Paste more of the posting before analyzing.");

    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste("x".repeat(40_001));
    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("Trim it to the posting itself before analyzing.");

    expect(api.calls["analyze-document"]).toBe(0);
  });

  it("sends the stored preferences inside profileData (T111)", async () => {
    const formSet = vi.spyOn(FormData.prototype, "set");
    seedSession();
    const preferences = { arrangements: ["remote" as const], maxOfficeDays: 2 };
    api.setProfile({ ...PROFILE, preferences });
    api.setDocumentResult(await resultFor("doc:prefs", "document"));
    window.history.pushState({}, "", "/upload");
    render(<App />);

    const input = await screen.findByLabelText(/upload a document/i);
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.upload(input, makeFile("job.pdf", "application/pdf"));
    await waitFor(() => expect(api.calls["analyze-document"]).toBe(1));

    const profileData = { text: PROFILE.text, dealbreakers: PROFILE.dealbreakers, preferences };
    expect(formSet).toHaveBeenCalledWith("profileData", JSON.stringify(profileData));
    expect(formSet).toHaveBeenCalledWith("profile", profileToPromptText(profileData));
    formSet.mockRestore();
  });

  it("sends a text part, no file part and profileData; the header reads 'From pasted text'; Save sends the paste fields", async () => {
    const formSet = vi.spyOn(FormData.prototype, "set");
    seedSession();
    api.setProfile(PROFILE);
    api.setDocumentResult(await resultFor("paste:abc", "paste"));
    window.history.pushState({}, "", "/upload?mode=paste");
    render(<App />);

    const box = await screen.findByLabelText("Pasted job posting");
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.click(box);
    await userEvent.paste(PASTE_TEXT);
    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await screen.findByText("From pasted text");
    const keys = formSet.mock.calls.map(([name]) => name);
    expect(keys).toContain("text");
    expect(keys).not.toContain("file");
    const profileData = { text: PROFILE.text, dealbreakers: PROFILE.dealbreakers };
    expect(formSet).toHaveBeenCalledWith("profileData", JSON.stringify(profileData));
    expect(formSet).toHaveBeenCalledWith("profile", profileToPromptText(profileData));

    await userEvent.click(screen.getByRole("button", { name: /save to library/i }));
    await screen.findByText(/Saved to your library/);
    formSet.mockRestore();
  });

  it("?mode=paste&rescore=<key> shows the cost line and PATCHes in place when the keys match", async () => {
    seedSession();
    api.setProfile(PROFILE);
    api.setAccount({
      email: "u@e.c",
      tier: "free",
      usage: {
        count: 50,
        limit: 50,
        resetsAt: "2026-08-01T00:00:00.000Z",
        rescoresUsed: 10,
        rescoresLimit: 10,
      },
      subscription: null,
    });
    api.setJobs([savedDoc("paste:abc", "paste")]);
    api.setDocumentResult(await resultFor("paste:abc", "paste"));
    const key = await saveKeyFor("paste:abc");

    window.history.pushState({}, "", `/upload?mode=paste&rescore=${key}`);
    render(<App />);

    await screen.findByText("No free rescores or analyses left this month");
    const box = await screen.findByLabelText("Pasted job posting");
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.click(box);
    await userEvent.paste(PASTE_TEXT);
    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await screen.findByText(/Rescored and updated in your library/);
    expect(api.patches).toHaveLength(1);
    expect(api.patches[0]!.key).toBe(key);
  });
});
