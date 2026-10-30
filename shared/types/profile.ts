/**
 * The structured profile a client sends as `profileData` (contracts/
 * analyze-api.md §1). The server serializes it with profileToPromptText, so
 * every surface scores against the same prompt (research R5, SC-006).
 * `preferences` arrives in PR4 and `confirmedSkills` in PR5; both are opaque
 * here until then.
 */
export interface ScoringProfile {
  text: string;
  dealbreakers: string[];
  preferences?: Record<string, unknown> | null;
  confirmedSkills?: string[];
}

const DEALBREAKERS_HEADING = "Dealbreakers:";

/**
 * Serialized candidate profile sent with analysis requests. Single source for
 * every surface that requests a fit score (extension analyze-job, web
 * analyze-document) so the same profile always yields the same prompt.
 *
 * Invariant (data-model.md §3): for `{text, dealbreakers}` the output is
 * byte-identical to the pre-006 implementation, so fingerprints stay stable.
 */
export function profileToPromptText<P extends ScoringProfile>(profile: P): string {
  if (profile.dealbreakers.length === 0) return profile.text;
  return `${profile.text}\n\n${DEALBREAKERS_HEADING}\n${profile.dealbreakers
    .map((d) => `- ${d}`)
    .join("\n")}`;
}

/**
 * Inverse of profileToPromptText for the Dealbreakers section only. The
 * server uses it to recover dealbreaker lines from a legacy string-only
 * request (research R8). Reads the last Dealbreakers heading, since the
 * serializer always appends that section after the résumé text.
 */
export function dealbreakerLinesFromPrompt(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.lastIndexOf(DEALBREAKERS_HEADING);
  if (start === -1) return [];
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) break;
    result.push(line.slice(2));
  }
  return result;
}
