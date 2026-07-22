import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";
import { clearSession, setAuthError } from "@/auth/authStore";
import { resetLibrary } from "@/lib/libraryStore";

// authStore / libraryStore are module-level singletons — reset them after
// every test so session/error/cache state never leaks across test files.
afterEach(() => {
  clearSession();
  setAuthError(null);
  resetLibrary();
});

// jsdom never actually loads the external GIS script, so every test mocks
// the thin wrapper around it — component tests exercise the real
// AuthProvider/authStore/apiClient path, just not the live Google script.
vi.mock("@/auth/googleIdentity", () => ({
  initGoogleIdentity: vi.fn().mockResolvedValue(undefined),
  promptSilent: vi.fn(),
  renderSignInButton: vi.fn(),
  disableAutoSelect: vi.fn(),
}));

// jsdom does not implement matchMedia (used for the dark-mode media query).
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}
