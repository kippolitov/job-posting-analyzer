import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PageAccessBlock } from "../../types/job";

interface PageAccessPromptProps {
  variant: PageAccessBlock;
  onOpenPaste?: () => void;
}

/**
 * What the panel shows when it cannot read the page. It is a next step, not
 * an error: Chrome grants page access only when the user clicks the toolbar
 * icon (or presses its shortcut), and nothing inside the panel can do that
 * for them. So the prompt shows WHERE to click — a miniature of the toolbar
 * with the icon marked, matching the "Go" badge the background paints on the
 * real icon — and how to reach the icon when it is not pinned.
 */
export function PageAccessPrompt({ variant, onOpenPaste }: PageAccessPromptProps) {
  if (variant === "restricted") {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            This page can&apos;t be analyzed
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Chrome doesn&apos;t let extensions read its own pages, like
            chrome:// pages and the Web Store. Open a job posting, or paste its
            text.
          </p>
          {onOpenPaste && (
            <button
              onClick={onOpenPaste}
              className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Paste text
            </button>
          )}
        </div>
      </div>
    );
  }

  return <NeedsClick onOpenPaste={onOpenPaste} />;
}

function NeedsClick({ onOpenPaste }: { onOpenPaste?: () => void }) {
  const pinned = useIsPinned();
  const shortcut = useActionShortcut();

  return (
    <div className="p-4">
      <section
        aria-labelledby="page-access-title"
        className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/30"
      >
        <ToolbarIllustration pinned={pinned !== false} />

        <h2
          id="page-access-title"
          className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          Click the extension icon to analyze this page
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Chrome lets an extension read a page only after you click its icon in
          the toolbar. The analysis starts right after — nothing else to do.
        </p>

        {pinned === false && (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">
            <li>
              Click the <PuzzleIcon className="inline h-3.5 w-3.5 align-[-2px]" />{" "}
              Extensions icon in the toolbar.
            </li>
            <li>
              Click <span className="font-medium text-gray-800 dark:text-gray-200">Job Posting Analyzer</span>.
              Pin it to keep it one click away next time.
            </li>
          </ol>
        )}

        {shortcut && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Or press{" "}
            <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 font-sans text-[11px] font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
              {shortcut}
            </kbd>
          </p>
        )}
      </section>

      {onOpenPaste && (
        <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
          Prefer not to?{" "}
          <button
            onClick={onOpenPaste}
            className="font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Paste the posting text instead
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * A miniature of the Chrome toolbar, right-aligned like the real one, with the
 * extension's icon marked. When the icon is not pinned it sits behind the
 * puzzle-piece menu, so that is what gets marked instead.
 */
function ToolbarIllustration({ pinned }: { pinned: boolean }) {
  return (
    <div aria-hidden="true" className="flex justify-end">
      <div className="relative flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <span className="h-3 w-3 rounded-full bg-gray-200 dark:bg-gray-600" />
        <span className="h-3 w-3 rounded-full bg-gray-200 dark:bg-gray-600" />
        {pinned ? (
          <>
            <PuzzleIcon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            <Highlighted>
              <img src="/icon-32.png" alt="" className="h-4 w-4" />
            </Highlighted>
          </>
        ) : (
          <Highlighted>
            <PuzzleIcon className="h-4 w-4 text-gray-700 dark:text-gray-200" />
          </Highlighted>
        )}
        <span className="h-3 w-3 rounded-full bg-gray-200 dark:bg-gray-600" />
      </div>
    </div>
  );
}

function Highlighted({ children }: { children: ReactNode }) {
  return (
    <span className="relative flex h-6 w-6 items-center justify-center">
      <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/40 motion-reduce:animate-none" />
      <span className="relative flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-blue-500">
        {children}
      </span>
      <span className="absolute -right-2.5 -top-2 rounded-sm bg-blue-600 px-1 text-[8px] font-bold leading-[12px] text-white">
        Go
      </span>
    </span>
  );
}

function PuzzleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
    </svg>
  );
}

/** `undefined` while unknown (or on a Chrome too old to say). */
function useIsPinned(): boolean | undefined {
  const [pinned, setPinned] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    const read = () => {
      void Promise.resolve(chrome.action?.getUserSettings?.())
        .then((settings) => {
          if (mounted && settings) setPinned(settings.isOnToolbar);
        })
        .catch(() => {});
    };
    read();
    // Pinning while the prompt is up should drop the "not pinned" steps.
    // Chrome 130+; missing from the installed typings.
    const onChanged = (
      chrome.action as unknown as {
        onUserSettingsChanged?: chrome.events.Event<() => void>;
      }
    )?.onUserSettingsChanged;
    const listener = () => read();
    onChanged?.addListener?.(listener);
    return () => {
      mounted = false;
      onChanged?.removeListener?.(listener);
    };
  }, []);
  return pinned;
}

/** The key bound to the toolbar action, if any (users can unbind it). */
function useActionShortcut(): string | null {
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve(chrome.commands?.getAll?.())
      .then((commands) => {
        const bound = commands?.find((c) => c.name === "_execute_action")?.shortcut;
        if (mounted && bound) setShortcut(bound);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  return shortcut;
}
