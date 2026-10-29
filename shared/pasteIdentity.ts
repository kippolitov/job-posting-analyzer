/**
 * Stable, content-derived identity for a paste-sourced posting (005 FR-021,
 * 006 research R7). Mirrors the `doc:<sha256 hex>` scheme from 004's
 * document uploads: normalize before hashing so incidental whitespace
 * differences between two copies of the same posting still resolve to one
 * identity, and prefix with "paste:" so the shape is unambiguous alongside
 * ordinary URLs and doc: identities.
 *
 * Shared by the extension's paste composer and the server's analyze-document
 * text part, so the same paste lands on the same saved entry on both
 * surfaces. Built on globalThis.crypto.subtle, which Node 20, the extension
 * service worker and browsers all provide.
 */
export async function pasteIdentity(text: string): Promise<string> {
  const normalized = text.replace(/\s+/g, " ").trim();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `paste:${hex}`;
}
