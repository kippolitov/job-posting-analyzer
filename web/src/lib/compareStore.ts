/** Small fixed max — legible side-by-side on mobile through desktop (research.md open items). */
export const MAX_COMPARE_SELECTION = 4;

let selected: string[] = [];
const listeners = new Set<(selected: string[]) => void>();

function notify(): void {
  for (const listener of listeners) listener(selected);
}

export function getCompareSelection(): string[] {
  return selected;
}

export function subscribeCompareSelection(listener: (selected: string[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Toggles a posting (by canonicalUrl) in/out of the compare selection, capped at MAX_COMPARE_SELECTION. */
export function toggleCompareSelection(canonicalUrl: string): void {
  if (selected.includes(canonicalUrl)) {
    selected = selected.filter((url) => url !== canonicalUrl);
  } else if (selected.length < MAX_COMPARE_SELECTION) {
    selected = [...selected, canonicalUrl];
  }
  notify();
}

export function clearCompareSelection(): void {
  selected = [];
  notify();
}
