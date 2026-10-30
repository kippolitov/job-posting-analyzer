import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import type { SavedJobPayload } from "@/api/types";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

const CURRENT = "c".repeat(64);
const OLDER = "o".repeat(64);

function job(overrides: Partial<SavedJobPayload> = {}, fitFingerprint?: string): SavedJobPayload {
  return {
    schemaVersion: 1,
    canonicalUrl: "https://example.com/jobs/1",
    sourceUrl: "https://example.com/jobs/1",
    source: "url",
    filename: "",
    status: "interested",
    notes: "",
    savedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    analysis: {
      isJobPosting: true,
      title: "Platform Engineer",
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
      fit: {
        score: 70,
        rationale: "Good.",
        ...(fitFingerprint ? { profileFingerprint: fitFingerprint } : {}),
        dealbreakersViolated: ["no on-site roles"],
      },
      model: "m",
      analyzedAt: "2026-07-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("posting detail freshness (006 US1)", () => {
  const api = installFakeApi();

  function withProfile() {
    api.setProfile({
      text: "Engineer",
      dealbreakers: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
      fingerprint: CURRENT,
    });
  }

  it("marks an out-of-date fit and links a URL posting to its source page", async () => {
    seedSession();
    withProfile();
    api.setJobs([job({}, OLDER)]);
    window.history.pushState({}, "", `/library/${encodeURIComponent("https://example.com/jobs/1")}`);
    render(<App />);

    await screen.findByText(/Scored against an older profile/);
    const link = screen.getByRole("link", { name: "Open posting to rescore" });
    expect(link).toHaveAttribute("href", "https://example.com/jobs/1");
  });

  it("marks a fit with no fingerprint as 'May be out of date'", async () => {
    seedSession();
    withProfile();
    api.setJobs([job()]);
    window.history.pushState({}, "", `/library/${encodeURIComponent("https://example.com/jobs/1")}`);
    render(<App />);
    await screen.findByText(/May be out of date/);
  });

  it("shows no marker for a current fit", async () => {
    seedSession();
    withProfile();
    api.setJobs([job({}, CURRENT)]);
    window.history.pushState({}, "", `/library/${encodeURIComponent("https://example.com/jobs/1")}`);
    render(<App />);
    await screen.findByRole("heading", { name: /platform engineer/i });
    expect(screen.queryByText(/older profile|May be out of date/)).not.toBeInTheDocument();
  });

  it("links a document posting to the upload page in rescore mode", async () => {
    seedSession();
    withProfile();
    const doc = job({ canonicalUrl: "doc:abc", sourceUrl: "", source: "document", filename: "j.pdf" }, OLDER);
    api.setJobs([doc]);
    window.history.pushState({}, "", `/library/${encodeURIComponent("doc:abc")}`);
    render(<App />);

    const link = await screen.findByRole("link", { name: "Upload again to rescore" });
    await vi_waitForHref(link);
    expect(link.getAttribute("href")).toMatch(/^\/upload\?rescore=[0-9a-f]{64}$/);
  });

  it("links a pasted posting to the paste option in rescore mode", async () => {
    seedSession();
    withProfile();
    const paste = job({ canonicalUrl: `paste:${"a".repeat(64)}`, sourceUrl: "", source: "paste" }, OLDER);
    api.setJobs([paste]);
    window.history.pushState({}, "", `/library/${encodeURIComponent(paste.canonicalUrl)}`);
    render(<App />);

    const link = await screen.findByRole("link", { name: "Paste again to rescore" });
    await vi_waitForHref(link);
    expect(link.getAttribute("href")).toMatch(/^\/upload\?mode=paste&rescore=[0-9a-f]{64}$/);
  });

  it("renders the unavailable note", async () => {
    seedSession();
    withProfile();
    api.setJobs([job({ unavailableAt: "2026-10-29T10:00:00.000Z" }, OLDER)]);
    window.history.pushState({}, "", `/library/${encodeURIComponent("https://example.com/jobs/1")}`);
    render(<App />);
    await screen.findByText(/Posting no longer available/);
  });

  it("shows the verdict label and accessible name, and who scored it", async () => {
    seedSession();
    withProfile();
    const scored = job({}, CURRENT);
    scored.analysis.tier = "premium";
    scored.analysis.fit = { score: 90, rationale: "r", profileFingerprint: CURRENT };
    api.setJobs([scored]);
    window.history.pushState({}, "", `/library/${encodeURIComponent("https://example.com/jobs/1")}`);
    render(<App />);

    expect(await screen.findByLabelText("Strong match, fit 90 out of 100")).toHaveTextContent(
      "Strong match"
    );
    expect(screen.getByText("Scored on Premium")).toBeInTheDocument();
  });

  it("a legacy fit is Unrated and names the model that scored it", async () => {
    seedSession();
    withProfile();
    const legacy = job();
    legacy.analysis.fit = { score: 72, rationale: "r" };
    api.setJobs([legacy]);
    window.history.pushState({}, "", `/library/${encodeURIComponent("https://example.com/jobs/1")}`);
    render(<App />);

    expect(await screen.findByLabelText("Unrated, fit 72 out of 100")).toBeInTheDocument();
    expect(screen.getByText("Scored by m")).toBeInTheDocument();
  });

  it("shows the dealbreaker banner above the score", async () => {
    seedSession();
    withProfile();
    api.setJobs([job({}, CURRENT)]);
    window.history.pushState({}, "", `/library/${encodeURIComponent("https://example.com/jobs/1")}`);
    render(<App />);
    await screen.findByText("Violates your dealbreaker: no on-site roles");
  });
});

/**
 * The document and paste links wait for the saved key (sha256) to compute. The
 * href first renders with an empty `rescore=`, so waiting for the substring
 * alone returns before the key exists and races on a slow runner.
 */
async function vi_waitForHref(link: HTMLElement): Promise<void> {
  const { waitFor } = await import("@testing-library/react");
  await waitFor(() => expect(link.getAttribute("href") ?? "").toMatch(/rescore=[0-9a-f]{64}$/));
}

describe("I have this on the posting detail (006 US5)", () => {
  const api = installFakeApi();

  function open(fitFingerprint: string = CURRENT, overrides: Partial<SavedJobPayload> = {}) {
    seedSession();
    api.setProfile({
      text: "Engineer",
      dealbreakers: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
      fingerprint: CURRENT,
    });
    const posting = job(overrides, fitFingerprint);
    posting.analysis.fit = {
      score: 60,
      rationale: "r",
      profileFingerprint: fitFingerprint,
      missing: ["Terraform"],
      desired: ["Go"],
      matching: ["Azure"],
    };
    api.setJobs([posting]);
    window.history.pushState({}, "", `/library/${encodeURIComponent(posting.canonicalUrl)}`);
    render(<App />);
  }

  it("offers I have <label> on missing and desired items only", async () => {
    open();
    expect(await screen.findByRole("button", { name: "I have Terraform" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I have Go" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I have Azure" })).not.toBeInTheDocument();
  });

  it("confirms the skill, marks the fit out of date and offers the source's rescore action", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "I have Terraform" }));

    await waitFor(() => expect(api.confirmedLabels).toEqual(["Terraform"]));
    expect(await screen.findByText(/Scored against an older profile/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open posting to rescore" })).toHaveAttribute(
      "href",
      "https://example.com/jobs/1"
    );
    expect(api.getProfile()?.confirmedSkills).toEqual(["Terraform"]);
    expect(api.patches).toHaveLength(0);
  });

  it("offers the upload route for a document posting", async () => {
    open(CURRENT, { canonicalUrl: "doc:abc", sourceUrl: "", source: "document", filename: "j.pdf" });
    await userEvent.click(await screen.findByRole("button", { name: "I have Terraform" }));
    expect(await screen.findByRole("link", { name: "Upload again to rescore" })).toBeInTheDocument();
  });

  it("on failure leaves the chip, shows the error and offers no rescore", async () => {
    open();
    api.failNext("profile-confirm", { status: 500, code: "SERVICE_ERROR", message: "Storage failed. Please try again." });
    await userEvent.click(await screen.findByRole("button", { name: "I have Terraform" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Storage failed. Please try again.");
    expect(screen.getByRole("button", { name: "I have Terraform" })).toBeEnabled();
    expect(screen.queryByText(/Scored against an older profile/)).not.toBeInTheDocument();
  });

  it("shows the over-limit message at the cap", async () => {
    open();
    api.failNext("profile-confirm", {
      status: 400,
      code: "PROFILE_TOO_LONG",
      message: "Profile text must be 20,000 characters or fewer.",
    });
    await userEvent.click(await screen.findByRole("button", { name: "I have Terraform" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Profile text must be 20,000 characters or fewer."
    );
  });
});
