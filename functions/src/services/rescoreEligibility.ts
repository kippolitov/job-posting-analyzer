import { FREE_RESCORES_PER_MONTH } from "../models/user";
import type { Fit } from "../models/job";

export type ChargeKind = "rescore" | "analysis";

export interface RescoreDecisionInput {
  /** The request's rescore intent; absent for an ordinary analysis. */
  intent: { priorFingerprint: string | null } | undefined;
  /** Fingerprint of the profile being sent; absent when no profile is sent. */
  currentFingerprint: string | undefined;
  /**
   * The saved posting's fit: `undefined` when nothing is saved under this
   * key, `null` when the saved posting was never scored.
   */
  savedFit: Fit | null | undefined;
  /** Profiles.fingerprintHistory; only consulted when nothing is saved. */
  fingerprintHistory: string[];
  rescoresUsed: number;
}

/**
 * Which counter a request is charged against (research R6). The saved row's
 * fingerprint is authoritative; without one, the claimed prior must be a
 * fingerprint the account really had. An ineligible rescore is never
 * rejected — it is metered as an ordinary analysis, as the spec requires.
 * Takes no tier, so both tiers get the same rule (FR-026).
 */
export function decideRescoreCharge(input: RescoreDecisionInput): ChargeKind {
  const { intent, currentFingerprint, savedFit } = input;
  if (!intent || !currentFingerprint) return "analysis";
  if (input.rescoresUsed >= FREE_RESCORES_PER_MONTH) return "analysis";

  if (savedFit !== undefined) {
    // A saved posting with no fit is a first scoring, not a rescore.
    if (savedFit === null) return "analysis";
    return savedFit.profileFingerprint === currentFingerprint
      ? "analysis"
      : "rescore";
  }

  const prior = intent.priorFingerprint;
  return prior !== null &&
    prior !== currentFingerprint &&
    input.fingerprintHistory.includes(prior)
    ? "rescore"
    : "analysis";
}
