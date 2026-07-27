/**
 * A short, word-boundary-safe excerpt of free text. Used wherever a title-
 * shaped label is needed but none was extracted — e.g. a paste-sourced
 * posting with no `analysis.title` (spec FR-020a: list surfaces must never
 * fall back to blank, a URL-shaped placeholder, or the raw `paste:<sha256>`
 * key).
 */
export function excerptOf(text: string, maxLength = 80): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  const cut = collapsed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}
