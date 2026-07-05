import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { OptionsApp } from "../../entrypoints/options/OptionsApp";
import { getProfile, setProfile } from "../../services/profileStorage";

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

  it("clears the stored profile", async () => {
    await setProfile({ text: "Senior TS engineer", dealbreakers: [] });
    render(<OptionsApp />);
    await screen.findByDisplayValue("Senior TS engineer");

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText("Profile cleared.")).toBeInTheDocument();
    await expect(getProfile()).resolves.toBeNull();
  });

  it("shows a character counter", async () => {
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Your background/)).toBeEnabled()
    );
    await userEvent.type(screen.getByLabelText(/Your background/), "abc");
    expect(
      screen.getByText((_, el) => el?.textContent === "3 / 4,000")
    ).toBeInTheDocument();
  });
});
