import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MigrationPrompt } from "../../components/MigrationPrompt";
import {
  runMigration,
  declineMigration,
} from "../../services/migrationService";
import type {
  LegacyData,
  MigrationOptions,
  MigrationResult,
} from "../../services/migrationService";
import type { CandidateProfile, SavedJob } from "../../types/job";

vi.mock("../../services/migrationService", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../services/migrationService")>();
  return {
    ...original,
    runMigration: vi.fn(),
    declineMigration: vi.fn().mockResolvedValue(undefined),
  };
});

const legacyData: LegacyData = {
  profile: {
    text: "Legacy profile",
    dealbreakers: [],
    updatedAt: "2026-06-01T00:00:00Z",
  },
  jobs: [
    { canonicalUrl: "https://a.example/1" } as SavedJob,
    { canonicalUrl: "https://a.example/2" } as SavedJob,
  ],
};

function completed(overrides: Partial<MigrationResult> = {}): MigrationResult {
  return {
    status: "completed",
    uploadedJobs: 2,
    skippedDuplicates: 1,
    profileOutcome: "uploaded",
    ...overrides,
  };
}

describe("MigrationPrompt", () => {
  const onDone = vi.fn();

  beforeEach(() => {
    onDone.mockClear();
    vi.mocked(runMigration).mockReset();
    vi.mocked(declineMigration).mockClear();
  });

  it("offers the one-time migration with explicit Accept and Decline actions", () => {
    render(<MigrationPrompt data={legacyData} onDone={onDone} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/2 saved postings/i)).toBeInTheDocument();
    expect(screen.getByText(/profile/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /migrate to my account/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /don't migrate/i })
    ).toBeInTheDocument();
  });

  it("declining records the choice, warns the data stays local, and closes", async () => {
    render(<MigrationPrompt data={legacyData} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: /don't migrate/i }));
    expect(declineMigration).toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows progress while the upload runs (>300 ms feedback)", async () => {
    let resolveRun: (r: MigrationResult) => void = () => {};
    vi.mocked(runMigration).mockImplementation(
      () => new Promise((resolve) => (resolveRun = resolve))
    );
    render(<MigrationPrompt data={legacyData} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: /^migrate/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/migrating/i);
    resolveRun(completed());
    await screen.findByText(/moved to your account/i);
  });

  it("shows the completion summary with uploaded and skipped counts", async () => {
    vi.mocked(runMigration).mockResolvedValue(completed());
    render(<MigrationPrompt data={legacyData} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: /^migrate/i }));

    expect(await screen.findByText(/2 postings uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/1 already in your account/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onDone).toHaveBeenCalled();
  });

  it("surfaces the profile conflict as an explicit user choice", async () => {
    vi.mocked(runMigration).mockImplementation(
      async (_data: LegacyData, options: MigrationOptions) => {
        const choice = await options.resolveProfileConflict(
          legacyData.profile as CandidateProfile,
          { text: "Server profile", dealbreakers: [], updatedAt: "2026-07-01" }
        );
        return completed({
          profileOutcome: choice === "local" ? "uploaded" : "kept-server",
        });
      }
    );
    render(<MigrationPrompt data={legacyData} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: /^migrate/i }));

    // Both versions offered; the user picks explicitly.
    expect(await screen.findByText(/which profile/i)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /keep this device's profile/i })
    );
    expect(await screen.findByText(/moved to your account/i)).toBeInTheDocument();
  });

  it("failure shows a retryable state and never claims completion", async () => {
    vi.mocked(runMigration)
      .mockResolvedValueOnce({
        status: "failed",
        uploadedJobs: 1,
        skippedDuplicates: 0,
        profileOutcome: "none",
        errorMessage: "network down",
      })
      .mockResolvedValueOnce(completed());

    render(<MigrationPrompt data={legacyData} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: /^migrate/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not finish/i);
    expect(screen.getByText(/still safe on this device/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText(/moved to your account/i)).toBeInTheDocument();
  });

  it("cap overflow surfaces the prune/export guidance instead of dropping records", async () => {
    vi.mocked(runMigration).mockResolvedValue({
      status: "cap-blocked",
      uploadedJobs: 3,
      skippedDuplicates: 0,
      profileOutcome: "none",
      errorMessage: "Library is at the 1,000-posting cap.",
    });
    render(<MigrationPrompt data={legacyData} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: /^migrate/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/full/i);
    expect(screen.getByText(/prune|export/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
