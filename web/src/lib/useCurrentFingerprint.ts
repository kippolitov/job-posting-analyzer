import { useEffect, useState } from "react";
import { fetchProfile } from "@/api/endpoints";

/**
 * The current profile's fingerprint for the freshness markers: `undefined`
 * while loading or when the fetch failed (unknown, so no marker rather than a
 * wrong one), `null` when the account has no profile.
 */
export function useCurrentFingerprint(): string | null | undefined {
  const [fingerprint, setFingerprint] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((profile) => {
        if (cancelled) return;
        setFingerprint(profile && profile.text ? (profile.fingerprint ?? null) : null);
      })
      .catch(() => {
        // Unknown: leave the markers off.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return fingerprint;
}
