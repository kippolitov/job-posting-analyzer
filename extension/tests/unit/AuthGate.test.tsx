import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "../../components/AuthGate";
import { signIn, signOut } from "../../services/auth/authService";
import { readAuthSnapshot, onAuthChange } from "../../services/auth/authState";
import type { AuthSnapshot } from "../../services/auth/authState";
import { detectLegacyData } from "../../services/migrationService";
import type { LegacyData } from "../../services/migrationService";
import { AuthError } from "../../types/auth";

vi.mock("../../services/auth/authService", () => ({
  signIn: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/auth/authState", () => ({
  readAuthSnapshot: vi.fn(),
  onAuthChange: vi.fn(() => () => {}),
}));

vi.mock("../../services/migrationService", () => ({
  detectLegacyData: vi.fn().mockResolvedValue(null),
  runMigration: vi.fn(),
  declineMigration: vi.fn().mockResolvedValue(undefined),
}));

const signedIn: AuthSnapshot = {
  status: "signed-in",
  user: { sub: "sub-1", email: "user@example.com" },
};
const signedOut: AuthSnapshot = { status: "signed-out", user: null };
const notAuthorized: AuthSnapshot = { status: "not-authorized", user: null };

function emitSnapshot(snapshot: AuthSnapshot): void {
  const listener = vi.mocked(onAuthChange).mock.calls.at(-1)?.[0];
  expect(listener).toBeDefined();
  act(() => listener!(snapshot));
}

describe("AuthGate", () => {
  beforeEach(() => {
    vi.mocked(readAuthSnapshot).mockReset();
    vi.mocked(signIn).mockReset();
    vi.mocked(onAuthChange).mockClear();
    vi.mocked(detectLegacyData).mockReset().mockResolvedValue(null);
  });

  it("signed out: shows the Google sign-in prompt and hides children", async () => {
    vi.mocked(readAuthSnapshot).mockResolvedValue(signedOut);
    render(
      <AuthGate>
        <div data-testid="feature">secret feature</div>
      </AuthGate>
    );
    expect(
      await screen.findByRole("button", { name: /sign in with google/i })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("feature")).not.toBeInTheDocument();
  });

  it("clicking sign-in shows progress and unlocks on success", async () => {
    vi.mocked(readAuthSnapshot).mockResolvedValue(signedOut);
    let resolveSignIn: (v: unknown) => void = () => {};
    vi.mocked(signIn).mockImplementation(
      () => new Promise((resolve) => (resolveSignIn = resolve)) as never
    );
    render(
      <AuthGate>
        <div data-testid="feature" />
      </AuthGate>
    );
    const button = await screen.findByRole("button", { name: /sign in with google/i });
    await userEvent.click(button);
    expect(await screen.findByText(/signing in/i)).toBeInTheDocument();

    vi.mocked(readAuthSnapshot).mockResolvedValue(signedIn);
    await act(async () => resolveSignIn(undefined));
    expect(await screen.findByTestId("feature")).toBeInTheDocument();
  });

  it("shows a plain-language message when sign-in is canceled", async () => {
    vi.mocked(readAuthSnapshot).mockResolvedValue(signedOut);
    vi.mocked(signIn).mockRejectedValue(
      new AuthError("sign-in-canceled", "Sign-in was canceled.")
    );
    render(<AuthGate>x</AuthGate>);
    await userEvent.click(
      await screen.findByRole("button", { name: /sign in with google/i })
    );
    expect(await screen.findByText(/sign-in was canceled/i)).toBeInTheDocument();
    // The gate stays: the user can try again.
    expect(
      screen.getByRole("button", { name: /sign in with google/i })
    ).toBeInTheDocument();
  });

  it("not authorized: shows the invitation message with a request-access action (FR-004)", async () => {
    vi.mocked(readAuthSnapshot).mockResolvedValue(notAuthorized);
    render(
      <AuthGate>
        <div data-testid="feature" />
      </AuthGate>
    );
    expect(await screen.findByText(/by invitation/i)).toBeInTheDocument();
    const requestLink = screen.getByRole("link", { name: /request access/i });
    expect(requestLink).toHaveAttribute("href", expect.stringContaining("mailto:"));
    expect(screen.queryByTestId("feature")).not.toBeInTheDocument();
  });

  it("signed in: renders children and a header with the account email and sign-out", async () => {
    vi.mocked(readAuthSnapshot).mockResolvedValue(signedIn);
    render(
      <AuthGate>
        <div data-testid="feature" />
      </AuthGate>
    );
    expect(await screen.findByTestId("feature")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    const signOutButton = screen.getByRole("button", { name: /sign out/i });
    await userEvent.click(signOutButton);
    expect(signOut).toHaveBeenCalled();
  });

  it("session expiry mid-edit: overlays the re-sign-in prompt without unmounting children (FR-014)", async () => {
    vi.mocked(readAuthSnapshot).mockResolvedValue(signedIn);
    render(
      <AuthGate>
        <input aria-label="notes" defaultValue="" />
      </AuthGate>
    );
    const input = await screen.findByLabelText("notes");
    await userEvent.type(input, "half-written note");

    emitSnapshot(signedOut);

    // The prompt appears, but the child (and its in-progress input) survives.
    expect(await screen.findByText(/session ended/i)).toBeInTheDocument();
    expect(screen.getByLabelText("notes")).toHaveValue("half-written note");

    emitSnapshot(signedIn);
    await waitFor(() =>
      expect(screen.queryByText(/session ended/i)).not.toBeInTheDocument()
    );
    expect(screen.getByLabelText("notes")).toHaveValue("half-written note");
  });

  it("offers the one-time migration after sign-in when legacy data exists (FR-010)", async () => {
    vi.mocked(readAuthSnapshot).mockResolvedValue(signedIn);
    vi.mocked(detectLegacyData).mockResolvedValue({
      profile: null,
      jobs: [{ canonicalUrl: "https://a.example/1" }],
    } as unknown as LegacyData);

    render(
      <AuthGate>
        <div data-testid="feature" />
      </AuthGate>
    );

    expect(
      await screen.findByRole("dialog", { name: /migrate/i })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("feature")).not.toBeInTheDocument();
  });

  it("revocation mid-session replaces the overlay with the invitation screen", async () => {
    vi.mocked(readAuthSnapshot).mockResolvedValue(signedIn);
    render(
      <AuthGate>
        <div data-testid="feature" />
      </AuthGate>
    );
    await screen.findByTestId("feature");
    emitSnapshot(notAuthorized);
    expect(await screen.findByText(/by invitation/i)).toBeInTheDocument();
    expect(screen.queryByTestId("feature")).not.toBeInTheDocument();
  });
});
