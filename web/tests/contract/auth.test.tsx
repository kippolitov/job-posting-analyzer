import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "@/App";
import { clearSession } from "@/auth/authStore";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

describe("auth contract (contracts/web-auth.md, spec US1 scenario 5)", () => {
  const api = installFakeApi();

  it("signed-out: renders only the landing page and fires no /api/jobs or /api/profile call", async () => {
    clearSession();
    render(<App />);

    await screen.findByRole("heading", { name: /job posting analyzer/i });
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();

    expect(api.calls.jobs).toBe(0);
    expect(api.calls.profile).toBe(0);
  });

  it("401 UNAUTHENTICATED on a protected call ends the session and returns to the sign-in landing", async () => {
    seedSession();
    api.failNext("jobs", { status: 401, code: "UNAUTHENTICATED", message: "invalid" });

    window.history.pushState({}, "", "/library");
    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it("403 NOT_AUTHORIZED (unverified email) surfaces the server's plain-language message", async () => {
    seedSession();
    api.failNext("jobs", {
      status: 403,
      code: "NOT_AUTHORIZED",
      message: "Sign-in requires a verified Google email address. Verify your email in your Google Account settings, then try again.",
    });

    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByText(/verify your email/i);
  });
});
