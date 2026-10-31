import { useEffect, useRef, useState } from "react";
import { pickerService } from "../../services/pickerService";
import type { PickerCandidate } from "../../services/pickerService";

export interface RegionListProps {
  tabId: number;
  /** Text and the region's selector, already re-resolved live at commit time (spec Edge Cases). */
  onCommit: (result: { text: string; selector: string }) => void;
  onCancel: () => void;
}

/**
 * The keyboard path for region selection (spec FR-024a, WCAG 2.1.1) — an
 * in-page overlay cannot take focus from a panel control, so this list lives
 * here instead. Arrow keys move the active region, Enter commits it (after
 * re-resolving it live, since the list may be stale by the time the user
 * acts — spec Edge Cases), Escape exits without side effects. Moving the
 * active region also highlights it on the page as a sighted-user supplement
 * (FR-024b) — a screen-reader user can act from this list alone.
 */
export function RegionList({ tabId, onCommit, onCancel }: RegionListProps) {
  const [candidates, setCandidates] = useState<PickerCandidate[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await pickerService.beginSession(tabId);
      const list = await pickerService.listCandidates(tabId);
      if (!cancelled) setCandidates(list);
    })();
    return () => {
      cancelled = true;
      void pickerService.clearPickerHighlight(tabId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // The listbox doesn't exist in the DOM until candidates finish loading
  // (the mount effect above starts that fetch), so focus can only move in
  // once it renders — FR-024a requires the keyboard path to be immediately
  // operable, not focused a tick before the list it operates on exists.
  useEffect(() => {
    if (candidates && candidates.length > 0) listRef.current?.focus();
  }, [candidates]);

  useEffect(() => {
    if (!candidates || candidates.length === 0) return;
    void pickerService.highlightCandidate(tabId, candidates[activeIndex].selector);
  }, [tabId, candidates, activeIndex]);

  const move = (delta: number): void => {
    if (!candidates || candidates.length === 0) return;
    setActiveIndex((prev) => (prev + delta + candidates.length) % candidates.length);
  };

  // `index` lets a click commit its own row: setActiveIndex has not applied
  // yet inside the same handler, so reading activeIndex would commit the
  // previously active region.
  const commit = async (index: number = activeIndex): Promise<void> => {
    if (!candidates || candidates.length === 0) return;
    const candidate = candidates[index];
    setCommitting(true);
    setError(null);
    const outcome = await pickerService.resolveCandidateText(tabId, candidate.selector);
    setCommitting(false);
    if (!outcome.ok) {
      setError(outcome.reason);
      return;
    }
    onCommit({ text: outcome.text, selector: candidate.selector });
  };

  const cancel = (): void => {
    void pickerService.clearPickerHighlight(tabId);
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const activeCandidate = candidates?.[activeIndex] ?? null;

  return (
    <div
      role="region"
      aria-label="Regions on this page"
      className="flex h-full flex-col"
    >
      <div className="flex items-center justify-between border-b border-gray-200/70 px-3 py-1.5 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Choose a region to analyze
        </h2>
        <button
          onClick={cancel}
          aria-label="Close region list"
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Close
        </button>
      </div>

      {/* FR-024b: announces the active region to a screen-reader user on
          every arrow-key move, matching the sighted in-page highlight. */}
      <div role="status" aria-live="polite" className="sr-only">
        {activeCandidate ? `${activeCandidate.label}, active` : ""}
      </div>

      {candidates === null ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Finding regions…</p>
        </div>
      ) : candidates.length === 0 ? (
        <div className="flex-1 p-4">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            No regions were found on this page.
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Try selecting the posting text on the page and using &quot;Analyze
            selection&quot; from the right-click menu instead.
          </p>
        </div>
      ) : (
        <>
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Regions on this page"
            aria-activedescendant={activeCandidate ? `region-option-${activeIndex}` : undefined}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="flex-1 space-y-1 overflow-y-auto p-2 outline-none"
          >
            {candidates.map((candidate, index) => (
              <li
                key={candidate.selector}
                id={`region-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                aria-label={`${candidate.label}, ${candidate.textLength.toLocaleString()} characters. ${candidate.excerpt}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  setActiveIndex(index);
                  void commit(index);
                }}
                className={`cursor-pointer rounded-lg border p-2 text-xs ${
                  index === activeIndex
                    ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/40"
                    : "border-gray-200 dark:border-gray-800"
                }`}
              >
                <p className="font-semibold text-gray-700 dark:text-gray-200">
                  {candidate.label}{" "}
                  <span className="font-normal text-gray-400 dark:text-gray-500">
                    · {candidate.textLength.toLocaleString()} characters
                  </span>
                </p>
                <p className="mt-0.5 truncate text-gray-500 dark:text-gray-400">
                  {candidate.excerpt}
                </p>
              </li>
            ))}
          </ul>
          {error && (
            <div
              role="alert"
              className="border-t border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30"
            >
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">{error}</p>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-gray-200/70 px-3 py-2 dark:border-gray-800">
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              ↑/↓ to move · Enter to analyze · Escape to close
            </p>
            <button
              onClick={() => void commit()}
              disabled={committing}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Analyze
            </button>
          </div>
        </>
      )}
    </div>
  );
}
