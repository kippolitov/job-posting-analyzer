import { useEffect, useState } from "react";
import { rescoreCostLine } from "../../../shared/fitView";
import { fetchAccount } from "../../services/accountService";
import { FINGERPRINT_KEY } from "../../services/profileStorage";

/**
 * The current profile fingerprint, kept live: it starts from what the
 * background reported with the result and follows `profile:fingerprint` in
 * session storage, which the options page writes after a profile save
 * (FR-007). `undefined` = not known yet, `null` = the account has no profile.
 */
export function useLiveFingerprint(
  reported: string | null | undefined
): string | null | undefined {
  const [live, setLive] = useState<string | null | undefined>(undefined);

  // A new result carries a fresher answer than any earlier live event.
  useEffect(() => {
    setLive(undefined);
  }, [reported]);

  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ): void => {
      if (area !== "session") return;
      const change = changes[FINGERPRINT_KEY];
      if (!change) return;
      const next = change.newValue as { value: string | null } | undefined;
      if (next) setLive(next.value);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return live !== undefined ? live : reported;
}

/** FR-004a: the cost line shown beside a Rescore action; `null` until known. */
export function useRescoreCostLine(enabled: boolean): string | null {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchAccount()
      .then(({ usage }) => {
        if (cancelled) return;
        if (usage.rescoresUsed === undefined || usage.rescoresLimit === undefined) {
          return;
        }
        setLine(
          rescoreCostLine({
            rescoresUsed: usage.rescoresUsed,
            rescoresLimit: usage.rescoresLimit,
            count: usage.count,
            limit: usage.limit,
          })
        );
      })
      .catch(() => {
        // The cost line is a courtesy; a failed fetch just omits it.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return line;
}
