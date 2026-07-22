import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";

/**
 * Gate for every account route (FR-002/SC-010): renders nothing account-
 * related until a verified session exists. During the initial silent-
 * refresh attempt no API call has fired yet, so a signed-out visitor never
 * reaches any account data.
 */
export function ProtectedRoute() {
  const { session, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-gray-500 dark:text-gray-400">
        Checking your session…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
