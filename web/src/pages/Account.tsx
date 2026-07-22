import { useEffect, useState } from "react";
import { fetchAccount } from "@/api/endpoints";
import type { AccountPayload } from "@/api/types";
import { ApiError } from "@/api/apiClient";
import { UsagePlanBanner } from "@/components/UsagePlanBanner";

/** GET /api/account view (FR-016). */
export function Account() {
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAccount()
      .then((result) => {
        if (!cancelled) setAccount(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load your account.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading your account…</div>;
  }

  if (error || !account) {
    return (
      <div role="alert" className="p-6 text-red-600">
        {error ?? "Couldn't load your account."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Account</h2>
      <UsagePlanBanner account={account} onAccountChange={setAccount} />
    </div>
  );
}
