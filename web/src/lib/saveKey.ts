import { useEffect, useState } from "react";

/**
 * The saved-job key: sha256 of the stored canonical URL, hex. Matches the
 * extension's `canonicalKey` and the server's row key; stored canonical URLs
 * (including `doc:` and `paste:` identities) are already canonical, so no
 * further normalization applies.
 */
export async function saveKeyFor(canonicalUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalUrl));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `""` until computed; only the document and paste rescore links need it. */
export function useSaveKey(canonicalUrl: string): string {
  const [key, setKey] = useState("");
  useEffect(() => {
    let cancelled = false;
    void saveKeyFor(canonicalUrl).then((k) => {
      if (!cancelled) setKey(k);
    });
    return () => {
      cancelled = true;
    };
  }, [canonicalUrl]);
  return key;
}
