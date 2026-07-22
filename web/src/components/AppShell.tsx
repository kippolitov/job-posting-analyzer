import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive
      ? "bg-blue-600 text-white"
      : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
  }`;

export function AppShell() {
  const { session, signOut } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 dark:border-gray-800">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 p-4"
        >
          <NavLink to="/library" className={navLinkClass}>
            Library
          </NavLink>
          <NavLink to="/compare" className={navLinkClass}>
            Compare
          </NavLink>
          <NavLink to="/upload" className={navLinkClass}>
            Analyze document
          </NavLink>
          <NavLink to="/profile" className={navLinkClass}>
            Profile
          </NavLink>
          <NavLink to="/account" className={navLinkClass}>
            Account
          </NavLink>
          <div className="ml-auto flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
            {session?.email}
            <button
              type="button"
              onClick={signOut}
              className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Sign out
            </button>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">
        <Outlet />
      </main>
      <footer className="border-t border-gray-200 p-4 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        <a
          href="https://kippolitov.github.io/job-posting-analyzer/legal/privacy-policy.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Privacy Policy
        </a>{" "}
        ·{" "}
        <a
          href="https://kippolitov.github.io/job-posting-analyzer/legal/terms.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Terms of Service
        </a>
      </footer>
    </div>
  );
}
