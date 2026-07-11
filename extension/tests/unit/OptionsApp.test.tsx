import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi } from "./helpers/mswStorageServer";
import { OptionsApp } from "../../entrypoints/options/OptionsApp";
import { getProfile, setProfile } from "../../services/profileStorage";

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
});
