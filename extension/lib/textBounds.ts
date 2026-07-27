/**
 * Shared below-minimum / above-cap refusal wording (spec FR-018a). Both the
 * paste composer (FR-018) and the scoped-region refusal (FR-034) state the
 * same bound violation the same way — a reviewer or user who hits one and
 * later the other should read one rule, not two unrelated messages. The
 * caller supplies only the next-action clause, which differs by context.
 */
export interface BoundViolation {
  message: string;
  action: string;
}

export function boundViolation(
  length: number,
  min: number,
  max: number,
  tooSmallAction: string,
  tooLargeAction: string
): BoundViolation | null {
  if (length < min) {
    return {
      message: `That's under the ${min.toLocaleString()}-character minimum.`,
      action: tooSmallAction,
    };
  }
  if (length > max) {
    return {
      message: `That's over the ${max.toLocaleString()}-character limit.`,
      action: tooLargeAction,
    };
  }
  return null;
}
