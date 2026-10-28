/**
 * Serialized candidate profile sent with analysis requests. Single source for
 * every surface that requests a fit score (extension analyze-job, web
 * analyze-document) so the same profile always yields the same prompt —
 * including the dealbreakers the fit-score cap depends on.
 */
export function profileToPromptText<
  P extends { text: string; dealbreakers: string[] },
>(profile: P): string {
  if (profile.dealbreakers.length === 0) return profile.text;
  return `${profile.text}\n\nDealbreakers:\n${profile.dealbreakers
    .map((d) => `- ${d}`)
    .join("\n")}`;
}
