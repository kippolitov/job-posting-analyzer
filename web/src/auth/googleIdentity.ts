/**
 * Thin wrapper around Google Identity Services (`google.accounts.id`),
 * loaded from Google's script — not bundled (contracts/web-auth.md).
 */

export interface GoogleIdentityConfig {
  clientId: string;
  onCredential: (idToken: string) => void;
}

interface GoogleAccountsId {
  initialize: (config: Record<string, unknown>) => void;
  prompt: (momentListener?: (notification: unknown) => void) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  disableAutoSelect: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let scriptLoadPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export async function initGoogleIdentity(config: GoogleIdentityConfig): Promise<void> {
  await loadGisScript();
  window.google!.accounts.id.initialize({
    client_id: config.clientId,
    callback: (response: { credential: string }) => config.onCredential(response.credential),
    auto_select: true,
  });
}

/** Silent re-issue attempt (One Tap with `auto_select`); no-ops before init. */
export function promptSilent(): void {
  window.google?.accounts.id.prompt();
}

export function renderSignInButton(
  parent: HTMLElement,
  options: Record<string, unknown> = {}
): void {
  window.google?.accounts.id.renderButton(parent, {
    theme: "outline",
    size: "large",
    text: "signin_with",
    ...options,
  });
}

export function disableAutoSelect(): void {
  window.google?.accounts.id.disableAutoSelect();
}
