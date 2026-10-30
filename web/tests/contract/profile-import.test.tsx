import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

const STORED = {
  text: "",
  dealbreakers: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
};

async function openProfile() {
  window.history.pushState({}, "", "/profile");
  render(<App />);
  await screen.findByRole("textbox", { name: "Profile" });
}

const pdf = () => new File([new Uint8Array(100)], "cv.pdf", { type: "application/pdf" });

describe("profile setup on the web (US4, FR-014/FR-015)", () => {
  const api = installFakeApi();

  it("has headed sections for résumé, dealbreakers and preferences", async () => {
    seedSession();
    await openProfile();
    for (const name of ["Résumé", "Dealbreakers", "Preferences"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("every preference field has an accessible label", async () => {
    seedSession();
    await openProfile();
    for (const name of [
      "Maximum office days",
      "Minimum salary",
      "Salary currency",
      "Salary period",
      "Minimum seniority",
      "Maximum seniority",
    ]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByRole("checkbox", { name: "Remote" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Hybrid" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "On-site" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I need visa sponsorship" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Locations or timezones/)).toBeInTheDocument();
  });

  it("importing a .pdf fills the editor and saves nothing until Save", async () => {
    seedSession();
    api.setImportText("Extracted CV text");
    await openProfile();

    await userEvent.upload(screen.getByLabelText(/Import a résumé/i), pdf());

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Profile" })).toHaveValue("Extracted CV text")
    );
    expect(api.calls["profile-import"]).toBe(1);
    expect(api.getProfile()).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findByRole("status");
    expect(api.getProfile()?.text).toBe("Extracted CV text");
  });

  it("shows the server's message when the file cannot be read", async () => {
    seedSession();
    const message =
      "No text could be extracted from this document. If it's a scanned image, OCR is not yet supported.";
    api.failNext("profile-import", { status: 422, code: "FILE_NO_TEXT", message });
    await openProfile();

    await userEvent.upload(screen.getByLabelText(/Import a résumé/i), pdf());

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("shows the over-limit message for imported text above 20,000 characters", async () => {
    seedSession();
    api.setImportText("x".repeat(25_000));
    await openProfile();

    await userEvent.upload(screen.getByLabelText(/Import a résumé/i), pdf());

    expect(await screen.findByText(/20,000 characters or fewer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("saves every preference through PUT and loads them back", async () => {
    seedSession();
    api.setProfile({ ...STORED, text: "Engineer" });
    await openProfile();

    await userEvent.click(screen.getByRole("checkbox", { name: "Remote" }));
    await userEvent.selectOptions(screen.getByLabelText("Maximum office days"), "2");
    await userEvent.type(screen.getByLabelText("Minimum salary"), "120000");
    await userEvent.clear(screen.getByLabelText("Salary currency"));
    await userEvent.type(screen.getByLabelText("Salary currency"), "USD");
    await userEvent.selectOptions(screen.getByLabelText("Salary period"), "year");
    await userEvent.selectOptions(screen.getByLabelText("Minimum seniority"), "senior");
    await userEvent.selectOptions(screen.getByLabelText("Maximum seniority"), "staff");
    await userEvent.type(screen.getByLabelText(/Locations or timezones/), "EU timezones only");
    await userEvent.click(screen.getByRole("checkbox", { name: "I need visa sponsorship" }));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findByRole("status");

    expect(api.getProfile()?.preferences).toEqual({
      arrangements: ["remote"],
      maxOfficeDays: 2,
      minSalary: { amount: 120000, currency: "USD", period: "year" },
      seniority: { min: "senior", max: "staff" },
      locations: ["EU timezones only"],
      needsSponsorship: true,
    });
  });

  it("loads stored preferences into the fields", async () => {
    seedSession();
    api.setProfile({
      ...STORED,
      text: "Engineer",
      preferences: { arrangements: ["hybrid"], maxOfficeDays: 0, needsSponsorship: true },
    });
    await openProfile();

    expect(await screen.findByRole("checkbox", { name: "Hybrid" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Remote" })).not.toBeChecked();
    expect(screen.getByLabelText("Maximum office days")).toHaveValue("0");
    expect(screen.getByRole("checkbox", { name: "I need visa sponsorship" })).toBeChecked();
  });

  it("lists seniority in enum order with management levels last", async () => {
    seedSession();
    await openProfile();
    const options = within(screen.getByLabelText("Maximum seniority"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "No maximum",
      "Junior",
      "Mid",
      "Senior",
      "Staff",
      "Principal",
      "Manager",
      "Director",
      "Executive",
    ]);
  });
});
