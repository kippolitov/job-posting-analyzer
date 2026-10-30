import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

// The fit-score dealbreaker cap only applies when the dealbreakers reach the
// model — the web app must edit them and send them exactly as the extension does.
describe("profile dealbreakers on the web (parity with the extension)", () => {
  const api = installFakeApi();

  it("loads, edits, and saves dealbreakers on the profile page", async () => {
    seedSession();
    api.setProfile({
      text: "Backend engineer.",
      dealbreakers: ["no fully on-site roles"],
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    });
    window.history.pushState({}, "", "/profile");
    render(<App />);

    const dealbreakers = await screen.findByRole("textbox", { name: /dealbreakers/i });
    expect(dealbreakers).toHaveValue("no fully on-site roles");

    await userEvent.type(dealbreakers, "\nno defense industry");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await screen.findByRole("status");
    expect(api.getProfile()?.dealbreakers).toEqual([
      "no fully on-site roles",
      "no defense industry",
    ]);
    expect(api.getProfile()?.text).toBe("Backend engineer.");
  });

  it("sends the dealbreakers with the profile on document analysis", async () => {
    // jsdom can't round-trip a multipart body through msw, so observe the
    // form as the client builds it.
    const formSet = vi.spyOn(FormData.prototype, "set");
    seedSession();
    api.setProfile({
      text: "Backend engineer.",
      dealbreakers: ["no fully on-site roles"],
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    });
    window.history.pushState({}, "", "/upload");
    render(<App />);

    const input = await screen.findByLabelText(/upload a document/i);
    await waitFor(() => expect(input).toBeEnabled());
    await waitFor(() => expect(api.calls.profile).toBe(1));
    await userEvent.upload(
      input,
      new File([new Uint8Array(100)], "job.pdf", { type: "application/pdf" })
    );

    await waitFor(() =>
      expect(formSet).toHaveBeenCalledWith(
        "profile",
        "Backend engineer.\n\nDealbreakers:\n- no fully on-site roles"
      )
    );
    formSet.mockRestore();
  });
});

describe("confirmed skills on the web profile (006 US5)", () => {
  const api = installFakeApi();

  function withSkills() {
    seedSession();
    api.setProfile({
      text: "Backend engineer.",
      dealbreakers: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
      confirmedSkills: ["Terraform", "Kubernetes"],
    });
    window.history.pushState({}, "", "/profile");
    render(<App />);
  }

  it("lists confirmed skills in their own section with a Remove button each", async () => {
    withSkills();
    const section = await screen.findByRole("region", { name: "Confirmed skills" });
    expect(within(section).getByText("Terraform")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Remove Terraform" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Remove Kubernetes" })).toBeInTheDocument();
  });

  it("removing one saves the profile without it", async () => {
    withSkills();
    await userEvent.click(await screen.findByRole("button", { name: "Remove Terraform" }));
    await waitFor(() => expect(api.getProfile()?.confirmedSkills).toEqual(["Kubernetes"]));
    expect(screen.queryByRole("button", { name: "Remove Terraform" })).not.toBeInTheDocument();
  });

  it("a normal save keeps the confirmed skills", async () => {
    withSkills();
    await userEvent.type(await screen.findByRole("textbox", { name: /dealbreakers/i }), "no crypto");
    await userEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("status");
    expect(api.getProfile()?.confirmedSkills).toEqual(["Terraform", "Kubernetes"]);
  });
});
