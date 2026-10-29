import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
