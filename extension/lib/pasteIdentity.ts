/**
 * Stable, content-derived identity for a paste-sourced posting (spec FR-021,
 * research R6). Mirrors the existing `doc:<sha256 hex>` scheme from feature
 * 004's document uploads: normalize before hashing so incidental whitespace
 * differences between two copies of the same posting still resolve to one
 * identity, and prefix with "paste:" so the shape is unambiguous alongside
 * ordinary URLs and doc: identities.
 */
export async function pasteIdentity(text: string): Promise<string> {
  const normalized = text.replace(/\s+/g, " ").trim();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `paste:${hex}`;
}
