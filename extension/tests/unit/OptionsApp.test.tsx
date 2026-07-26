import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi } from "./helpers/mswStorageServer";
import { OptionsApp } from "../../entrypoints/options/OptionsApp";
import { getProfile, setProfile } from "../../services/profileStorage";
import { learnedSelectors } from "../../services/learnedSelectors";

// profileStorage is server-backed since 002; run it against the
// contract-faithful fake API instead of chrome.storage.
const api = installFakeStorageApi();

// These tests cover the profile editor behind the gate; AuthGate has its own suite.
vi.mock("../../services/auth/authState", () => ({
  readAuthSnapshot: vi.fn().mockResolvedValue({
    status: "signed-in",
    user: { sub: "sub-1", email: "user@example.com" },
  }),
  onAuthChange: vi.fn(() => () => {}),
}));

beforeEach(() => {
  installMemoryStorage("local");
});

describe("OptionsApp", () => {
  it("saves the profile with dealbreakers split per line", async () => {
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Your background/)).toBeEnabled()
    );

    await userEvent.type(
      screen.getByLabelText(/Your background/),
      "Principal .NET engineer"
    );
    await userEvent.type(
      screen.getByLabelText(/Dealbreakers/),
      "no fully on-site roles\nno defense industry"
    );
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
    const profile = await getProfile();
    expect(profile!.text).toBe("Principal .NET engineer");
    expect(profile!.dealbreakers).toEqual([
      "no fully on-site roles",
      "no defense industry",
    ]);
  });

  it("loads an existing profile into the form", async () => {
    await setProfile({ text: "Senior TS engineer", dealbreakers: ["no crypto"] });
    render(<OptionsApp />);

    expect(await screen.findByDisplayValue("Senior TS engineer")).toBeInTheDocument();
    expect(screen.getByDisplayValue("no crypto")).toBeInTheDocument();
  });

  it("deletes the stored profile", async () => {
    await setProfile({ text: "Senior TS engineer", dealbreakers: [] });
    render(<OptionsApp />);
    await screen.findByDisplayValue("Senior TS engineer");

    await userEvent.click(screen.getByRole("button", { name: "Delete profile" }));
    expect(await screen.findByText("Profile deleted.")).toBeInTheDocument();
    await expect(getProfile()).resolves.toBeNull();
  });

  it("shows a character counter", async () => {
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Your background/)).toBeEnabled()
    );
    await userEvent.type(screen.getByLabelText(/Your background/), "abc");
    expect(
      screen.getByText((_, el) => el?.textContent === "3 / 20,000")
    ).toBeInTheDocument();
  });

  it("does not offer sign-out on the profile screen", async () => {
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Your background/)).toBeEnabled()
    );
    expect(
      screen.queryByRole("button", { name: "Sign out" })
    ).not.toBeInTheDocument();
  });

  it("shows a retryable error instead of an empty form when the load fails (FR-015)", async () => {
    api.setProfile({
      text: "Existing profile",
      dealbreakers: [],
      updatedAt: "2026-07-07T00:00:00Z",
    });
    api.failNext(500);
    render(<OptionsApp />);

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your background/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText(/Your background/)).toHaveValue(
      "Existing profile"
    );
  });

  it("surfaces a failed save as an alert and keeps the form input (FR-015)", async () => {
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Your background/)).toBeEnabled()
    );
    await userEvent.type(screen.getByLabelText(/Your background/), "My profile");

    api.failNext(500);
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Profile saved.")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Your background/)).toHaveValue("My profile");
  });

  it("mounts the AccountBar above the profile editor (plan/usage always visible, FR-013)", async () => {
    render(<OptionsApp />);
    expect(await screen.findByLabelText("Plan: Free")).toBeInTheDocument();
    expect(screen.getByText("0 of 50 analyses this month")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/Your background/)).toBeEnabled()
    );
  });

  describe("always-analyzed regions (spec FR-031)", () => {
    it("shows the empty state when nothing is learned", async () => {
      render(<OptionsApp />);
      expect(
        await screen.findByText(/No sites are set to always analyze/)
      ).toBeInTheDocument();
    });

    it("lists every learned host", async () => {
      await learnedSelectors.put("jobs.example.com", ".job-body");
      await learnedSelectors.put("careers.example.org", "main");
      render(<OptionsApp />);

      expect(await screen.findByText("jobs.example.com")).toBeInTheDocument();
      expect(screen.getByText("careers.example.org")).toBeInTheDocument();
    });

    it("clears a single host without touching the others", async () => {
      await learnedSelectors.put("jobs.example.com", ".job-body");
      await learnedSelectors.put("careers.example.org", "main");
      render(<OptionsApp />);
      await screen.findByText("jobs.example.com");

      await userEvent.click(
        screen.getByRole("button", { name: "Clear region for jobs.example.com" })
      );

      await waitFor(() =>
        expect(screen.queryByText("jobs.example.com")).not.toBeInTheDocument()
      );
      expect(screen.getByText("careers.example.org")).toBeInTheDocument();
      expect(await learnedSelectors.get("jobs.example.com")).toBeNull();
    });

    it("'Clear all site regions' removes everything, immediately, with no confirmation dialog", async () => {
      await learnedSelectors.put("jobs.example.com", ".job-body");
      await learnedSelectors.put("careers.example.org", "main");
      render(<OptionsApp />);
      await screen.findByText("jobs.example.com");

      await userEvent.click(screen.getByRole("button", { name: "Clear all site regions" }));

      expect(
        await screen.findByText(/No sites are set to always analyze/)
      ).toBeInTheDocument();
      expect(await learnedSelectors.list()).toEqual([]);
    });
  });
});
