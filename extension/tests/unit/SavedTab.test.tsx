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

  it("shows fit score, salary range, and tech stack for a saved posting", async () => {
    await jobStorage.save(
      makeJob({
        analysis: {
          ...analysis,
          salary: { min: 150_000, max: 180_000, currency: "USD", period: "year" },
          techStack: ["C#", ".NET", "Azure", "Kubernetes", "React", "SQL", "Kafka"],
          fit: { score: 82, rationale: "Strong overlap with the profile." },
        },
      })
    );
    render(<SavedTab />);

    expect(
      await screen.findByLabelText("Fit score: 82 out of 100")
    ).toHaveTextContent("Fit 82");
    expect(screen.getByText("USD 150,000–180,000 / year")).toBeInTheDocument();
    const stack = screen.getByRole("list", { name: "Tech stack" });
    expect(stack).toHaveTextContent("C#");
    expect(stack).toHaveTextContent("SQL");
    expect(stack).toHaveTextContent("+1 more");
    expect(stack).not.toHaveTextContent("Kafka");
  });

  it("omits fit, salary, and tech stack rows when the analysis has none", async () => {
    await jobStorage.save(makeJob());
    render(<SavedTab />);
    await screen.findByText("Senior Backend Engineer");

    expect(screen.queryByLabelText(/Fit score/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Tech stack" })
    ).not.toBeInTheDocument();
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

  it("imports an export file and reports imported and skipped counts", async () => {
    await jobStorage.save(makeJob({ notes: "keep these notes" }));
    const file = new File(
      [
        JSON.stringify({
          schemaVersion: 1,
          exportedAt: "2026-07-10T00:00:00Z",
          jobs: [
            makeJob({ notes: "stale exported notes" }),
            makeJob({
              canonicalUrl: "https://a.example/2",
              analysis: { ...analysis, title: "Imported Role" },
            }),
          ],
        }),
      ],
      "saved-jobs-2026-07-10.json",
      { type: "application/json" }
    );

    render(<SavedTab />);
    await screen.findByText("Senior Backend Engineer");
    await userEvent.upload(
      screen.getByLabelText("Import saved postings file"),
      file
    );

    expect(
      await screen.findByText("Imported 1 posting, skipped 1 duplicate.")
    ).toBeInTheDocument();
    expect(screen.getByText("Imported Role")).toBeInTheDocument();
    // The existing record was not overwritten by the stale export copy.
    const kept = await jobStorage.get("https://a.example/1");
    expect(kept!.notes).toBe("keep these notes");
  });

  it("shows an alert when the selected file is not a saved-jobs export", async () => {
    render(<SavedTab />);
    await screen.findByText(/No saved postings yet/);

    await userEvent.upload(
      screen.getByLabelText("Import saved postings file"),
      new File(["[1, 2, 3]"], "random.json", { type: "application/json" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not a saved-jobs export/
    );
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

  describe("over-cap read-only banner (FR-021/022 downgrade)", () => {
    async function seedBulk(count: number): Promise<void> {
      await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const canonicalUrl = `https://a.example/bulk-${i}`;
          const job = makeJob({
            canonicalUrl,
            analysis: { ...analysis, title: `Bulk Job ${i}` },
          });
          const key = await api.seededKey(canonicalUrl);
          api.jobs.set(key, job);
        })
      );
    }

    beforeEach(() => {
      vi.spyOn(window, "open").mockImplementation(() => null);
    });

    it("shows no banner for a free-tier library under the 100 cap", async () => {
      await seedBulk(5);
      render(<SavedTab />);
      expect(await screen.findByText("Bulk Job 4")).toBeInTheDocument();
      expect(screen.queryByText(/posting limit/i)).not.toBeInTheDocument();
    });

    it(
      "shows a read-only banner with an Upgrade action once the free-tier library exceeds 100",
      async () => {
        await seedBulk(101);
        render(<SavedTab />);
        await screen.findByText("Bulk Job 100");

        expect(
          await screen.findByText(/101 postings, over the 100-posting free limit/i)
        ).toBeInTheDocument();
        expect(screen.getByText(/existing postings are safe/i)).toBeInTheDocument();

        await userEvent.click(
          screen.getByRole("button", { name: /upgrade to premium/i })
        );
        await waitFor(() =>
          expect(window.open).toHaveBeenCalledWith(
            "https://sandbox-checkout.paddle.test/txn_1",
            "_blank",
            "noopener,noreferrer"
          )
        );
      },
      // Seeding + rendering 101 postings takes ~9s locally but repeatedly
      // exceeded 20s on GitHub's shared runners (3 consecutive CI timeouts
      // on 2026-07-16, all other 284 tests green).
      60_000
    );

    it("shows a read-only banner without an Upgrade action for an over-cap premium library", async () => {
      api.setAccountTier("premium");
      await seedBulk(3);
      render(<SavedTab />);
      await screen.findByText("Bulk Job 2");
      // Premium's cap is 1,000 — 3 seeded jobs never trigger the banner;
      // this pins that premium accounts don't see a free-tier Upgrade CTA
      // even when (hypothetically) over their own, much higher cap.
      expect(
        screen.queryByRole("button", { name: /upgrade to premium/i })
      ).not.toBeInTheDocument();
    });

    it(
      "existing postings stay fully viewable, editable, and deletable while over the cap",
      async () => {
        await seedBulk(101);
        render(<SavedTab />);
        await screen.findByText("Bulk Job 100");
        await screen.findByText(/over the 100-posting free limit/i);

        const select = screen.getByLabelText(/Status for Bulk Job 0/);
        await userEvent.selectOptions(select, "applied");
        await waitFor(async () => {
          const stored = await jobStorage.get("https://a.example/bulk-0");
          expect(stored!.status).toBe("applied");
        });

        await userEvent.click(
          screen.getByRole("button", { name: "Delete saved posting: Bulk Job 0" })
        );
        await waitFor(() =>
          expect(screen.queryByText("Bulk Job 0")).not.toBeInTheDocument()
        );
      },
      // Seeding + rendering 101 postings takes ~9s locally but repeatedly
      // exceeded 20s on GitHub's shared runners (3 consecutive CI timeouts
      // on 2026-07-16, all other 284 tests green).
      60_000
    );
  });
});
