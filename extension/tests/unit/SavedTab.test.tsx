import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi } from "./helpers/mswStorageServer";
import { SavedTab } from "../../components/JobPanel/SavedTab";
import { jobStorage } from "../../services/jobStorage";
import type { JobAnalysis, SavedJob } from "../../types/job";

// jobStorage is server-backed since 002; run it against the contract-faithful
// fake API instead of chrome.storage.
const api = installFakeStorageApi();

const analysis: JobAnalysis = {
  isJobPosting: true,
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Austin, TX",
  arrangement: "hybrid",
  arrangementConfidence: "explicit",
  arrangementEvidence: "hybrid, 3 days per week",
  daysInOffice: 3,
  daysRemote: 2,
  remoteRestrictions: null,
  salary: null,
  seniority: "senior",
  techStack: [],
  fit: null,
  model: "gpt-4o-mini",
  analyzedAt: "2026-07-04T12:00:04Z",
};

function makeJob(overrides: Partial<SavedJob> = {}): SavedJob {
  return {
    schemaVersion: 1,
    canonicalUrl: "https://a.example/1",
    sourceUrl: "https://a.example/1",
    analysis,
    status: "interested",
    notes: "",
    savedAt: "2026-07-04T12:01:00Z",
    updatedAt: "2026-07-04T12:01:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  installMemoryStorage("local");
});

describe("SavedTab", () => {
  it("shows the empty state when nothing is saved", async () => {
    render(<SavedTab />);
    expect(await screen.findByText(/No saved postings yet/)).toBeInTheDocument();
  });

  it("lists saved postings with a link back to the original URL", async () => {
    await jobStorage.save(makeJob());
    render(<SavedTab />);

    const link = await screen.findByRole("link", {
      name: "Open posting: Senior Backend Engineer",
    });
    expect(link).toHaveAttribute("href", "https://a.example/1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("filters by status", async () => {
    await jobStorage.save(makeJob({ canonicalUrl: "https://a.example/1" }));
    await jobStorage.save(
      makeJob({
        canonicalUrl: "https://a.example/2",
        status: "applied",
        analysis: { ...analysis, title: "Applied Role" },
      })
    );
    render(<SavedTab />);
    await screen.findByText("Applied Role");

    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "applied");
    await waitFor(() => {
      expect(screen.queryByText("Senior Backend Engineer")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Applied Role")).toBeInTheDocument();
  });

  it("filters by arrangement", async () => {
    await jobStorage.save(makeJob({ canonicalUrl: "https://a.example/1" }));
    await jobStorage.save(
      makeJob({
        canonicalUrl: "https://a.example/2",
        analysis: { ...analysis, arrangement: "remote", title: "Remote Role" },
      })
    );
    render(<SavedTab />);
    await screen.findByText("Remote Role");

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by arrangement"),
      "remote"
    );
    await waitFor(() => {
      expect(screen.queryByText("Senior Backend Engineer")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Remote Role")).toBeInTheDocument();
  });

  it("changes status and persists immediately", async () => {
    await jobStorage.save(makeJob());
    render(<SavedTab />);
    const select = await screen.findByLabelText(/Status for Senior Backend Engineer/);

    await userEvent.selectOptions(select, "interviewing");
    await waitFor(async () => {
      const stored = await jobStorage.get("https://a.example/1");
      expect(stored!.status).toBe("interviewing");
    });
  });

  it("persists notes on blur", async () => {
    await jobStorage.save(makeJob());
    render(<SavedTab />);
    const notes = await screen.findByLabelText(/Notes for Senior Backend Engineer/);

    await userEvent.type(notes, "phone screen Friday");
    await userEvent.tab();
    await waitFor(async () => {
      const stored = await jobStorage.get("https://a.example/1");
      expect(stored!.notes).toBe("phone screen Friday");
    });
  });

  it("deletes a posting", async () => {
    await jobStorage.save(makeJob());
    render(<SavedTab />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Delete saved posting: Senior Backend Engineer",
      })
    );
    expect(await screen.findByText(/No saved postings yet/)).toBeInTheDocument();
    await expect(jobStorage.get("https://a.example/1")).resolves.toBeNull();
  });

  it("toggles sort order between newest and oldest", async () => {
    await jobStorage.save(
      makeJob({
        canonicalUrl: "https://a.example/old",
        savedAt: "2026-06-01T00:00:00Z",
        analysis: { ...analysis, title: "Old Role" },
      })
    );
    await jobStorage.save(
      makeJob({
        canonicalUrl: "https://a.example/new",
        savedAt: "2026-07-01T00:00:00Z",
        analysis: { ...analysis, title: "New Role" },
      })
    );
    render(<SavedTab />);
    await screen.findByText("New Role");

    const titles = () =>
      screen.getAllByRole("link").map((el) => el.textContent);
    expect(titles()).toEqual(["New Role", "Old Role"]);

    await userEvent.click(screen.getByRole("button", { name: /Sorted by date saved/ }));
    expect(titles()).toEqual(["Old Role", "New Role"]);
  });

  it("exports the library as a JSON download", async () => {
    await jobStorage.save(makeJob());
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<SavedTab />);
    await screen.findByText("Senior Backend Engineer");
    await userEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("shows a retryable error instead of an empty library when the load fails (FR-015)", async () => {
    await jobStorage.save(makeJob());
    api.failNext(500);
    render(<SavedTab />);

    expect(
      await screen.findByText(/could not be loaded/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/No saved postings/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("Senior Backend Engineer")
    ).toBeInTheDocument();
  });

  it("surfaces a failed mutation as an alert without dropping the list", async () => {
    await jobStorage.save(makeJob());
    render(<SavedTab />);
    await screen.findByText("Senior Backend Engineer");

    api.failNext(500);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument();
  });
});
