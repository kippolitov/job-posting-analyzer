import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
      screen.getByRole("textbox", { name: /dealbreakers/i }),
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

  it("organizes the editor into headed sections for résumé, dealbreakers and preferences (FR-015)", async () => {
    render(<OptionsApp />);
    await waitFor(() => expect(screen.getByLabelText(/Your background/)).toBeEnabled());
    for (const name of ["Résumé", "Dealbreakers", "Preferences"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  describe("résumé import (US4)", () => {
    const pdf = () => new File([new Uint8Array(100)], "cv.pdf", { type: "application/pdf" });

    async function importFile(file: File) {
      await waitFor(() => expect(screen.getByLabelText(/Your background/)).toBeEnabled());
      await userEvent.upload(screen.getByLabelText(/Import a résumé/i), file);
    }

    it("fills the editor with the extracted text and saves nothing until Save", async () => {
      api.setImportResponse({ status: 200, body: { text: "Extracted CV text", charCount: 17 } });
      render(<OptionsApp />);
      await importFile(pdf());

      expect(await screen.findByDisplayValue("Extracted CV text")).toBeInTheDocument();
      expect(api.importCalls()).toBe(1);
      expect(api.getProfile()).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
      expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
      expect(api.getProfile()?.text).toBe("Extracted CV text");
    });

    it("shows the server's message, the same copy as job uploads, and keeps the text", async () => {
      const message =
        "No text could be extracted from this document. If it's a scanned image, OCR is not yet supported.";
      api.setImportResponse({
        status: 422,
        body: { error: { code: "FILE_NO_TEXT", message } },
      });
      render(<OptionsApp />);
      await waitFor(() => expect(screen.getByLabelText(/Your background/)).toBeEnabled());
      await userEvent.type(screen.getByLabelText(/Your background/), "Typed already");
      await userEvent.upload(screen.getByLabelText(/Import a résumé/i), pdf());

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByLabelText(/Your background/)).toHaveValue("Typed already");
    });

    it("shows the over-limit message for imported text above 20,000 characters and blocks Save", async () => {
      api.setImportResponse({
        status: 200,
        body: { text: "x".repeat(25_000), charCount: 25_000 },
      });
      render(<OptionsApp />);
      await importFile(pdf());

      expect(await screen.findByText(/20,000 characters or fewer/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    });
  });

  describe("preferences (US4)", () => {
    async function ready() {
      render(<OptionsApp />);
      await waitFor(() => expect(screen.getByLabelText(/Your background/)).toBeEnabled());
    }

    it("saves every preference through PUT and loads them back", async () => {
      await ready();
      await userEvent.type(screen.getByLabelText(/Your background/), "Engineer");
      await userEvent.click(screen.getByRole("checkbox", { name: "Remote" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Hybrid" }));
      await userEvent.selectOptions(screen.getByLabelText("Maximum office days"), "2");
      await userEvent.type(screen.getByLabelText("Minimum salary"), "120000");
      await userEvent.clear(screen.getByLabelText("Salary currency"));
      await userEvent.type(screen.getByLabelText("Salary currency"), "USD");
      await userEvent.selectOptions(screen.getByLabelText("Salary period"), "year");
      await userEvent.selectOptions(screen.getByLabelText("Minimum seniority"), "senior");
      await userEvent.selectOptions(screen.getByLabelText("Maximum seniority"), "staff");
      await userEvent.type(
        screen.getByLabelText(/Locations or timezones/),
        "EU timezones only"
      );
      await userEvent.click(screen.getByRole("checkbox", { name: "I need visa sponsorship" }));
      await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

      expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
      const expected = {
        arrangements: ["remote", "hybrid"],
        maxOfficeDays: 2,
        minSalary: { amount: 120000, currency: "USD", period: "year" },
        seniority: { min: "senior", max: "staff" },
        locations: ["EU timezones only"],
        needsSponsorship: true,
      };
      expect(api.getProfile()?.preferences).toEqual(expected);

      cleanup();
      render(<OptionsApp />);
      expect(await screen.findByRole("checkbox", { name: "Remote" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Hybrid" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "On-site" })).not.toBeChecked();
      expect(screen.getByLabelText("Maximum office days")).toHaveValue("2");
      expect(screen.getByLabelText("Minimum salary")).toHaveValue("120000");
      expect(screen.getByLabelText("Minimum seniority")).toHaveValue("senior");
      expect(screen.getByLabelText("Maximum seniority")).toHaveValue("staff");
      expect(screen.getByLabelText(/Locations or timezones/)).toHaveValue("EU timezones only");
      expect(screen.getByRole("checkbox", { name: "I need visa sponsorship" })).toBeChecked();
    });

    it("lists seniority in enum order with management levels last, and offers No limit for office days", async () => {
      await ready();
      const options = within(screen.getByLabelText("Minimum seniority"))
        .getAllByRole("option")
        .map((o) => o.textContent);
      expect(options).toEqual([
        "No minimum",
        "Junior",
        "Mid",
        "Senior",
        "Staff",
        "Principal",
        "Manager",
        "Director",
        "Executive",
      ]);
      const days = within(screen.getByLabelText("Maximum office days"))
        .getAllByRole("option")
        .map((o) => o.textContent);
      expect(days).toEqual(["No limit", "0", "1", "2", "3", "4", "5"]);
    });

    it("clears stored preferences when every field is emptied", async () => {
      api.setProfile({
        text: "Engineer",
        dealbreakers: [],
        updatedAt: "2026-07-07T00:00:00Z",
        preferences: { arrangements: ["remote"] },
      });
      render(<OptionsApp />);
      await userEvent.click(await screen.findByRole("checkbox", { name: "Remote" }));
      await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
      await screen.findByText("Profile saved.");
      expect(api.getProfile()?.preferences).toBeUndefined();
    });

    it("refuses to save a salary that is not a positive number", async () => {
      await ready();
      await userEvent.type(screen.getByLabelText(/Your background/), "Engineer");
      await userEvent.type(screen.getByLabelText("Minimum salary"), "lots");
      await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/salary/i);
      expect(api.getProfile()).toBeNull();
    });
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
