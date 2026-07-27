/**
 * Reads the LIVE page selection for "Analyze selection" (spec FR-023a,
 * FR-023b). The context menu payload's own `selectionText` is truncated and
 * job postings routinely exceed it — this instead re-reads
 * `window.getSelection()` from inside the page via `executeScript`, which is
 * never truncated.
 *
 * The injected function is serialized by chrome.scripting.executeScript and
 * MUST stay self-contained: no imports, no closures over module scope. The
 * selector-generation logic therefore duplicates `lib/selectorPath.ts` inline
 * rather than importing it — the same documented exception plan.md records
 * for `extension/scripts/corpusProbe.ts`. Keep the two in sync by hand.
 */

export interface LiveSelectionResult {
  ok: true;
  /** The full selected text — never the context-menu payload's truncated copy. */
  text: string;
  /** A selector reducing the selection's common ancestor for learning (FR-023c). */
  selector: string;
}

export interface LiveSelectionFailure {
  ok: false;
  reason: string;
  /**
   * FR-036a requires cause-specific wording, not one generic message: an
   * empty selection is fixable by selecting again; a shadow-root or
   * cross-origin-iframe selection ("unscopeable") never is, no matter how
   * many times the user re-selects.
   */
  cause: "empty" | "unscopeable";
}

export type LiveSelectionOutcome = LiveSelectionResult | LiveSelectionFailure;

/**
 * Runs inside the target page via executeScript. Self-contained by the same
 * rule as `extractPage` (plan.md Constraints). Exported so real-Chromium
 * tests can evaluate it directly, the same way tests/extractor's helpers
 * evaluate `extractPage` (research R9 — this needs a live Selection API).
 */
export function readLiveSelectionInPage(): LiveSelectionOutcome {
  const MACHINE_GENERATED_RE = /^(css|sc|jsx|emotion)-|[-_][a-z0-9]{5,}$/i;
  const MAX_SEGMENTS = 4;

  function humanClasses(el: Element): string[] {
    return Array.from(el.classList).filter(
      (c) => c.length > 0 && !MACHINE_GENERATED_RE.test(c)
    );
  }

  function firstDataAttribute(el: Element): string | null {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-")) return attr.name;
    }
    return null;
  }

  function nthOfType(el: Element): number {
    const parent = el.parentElement;
    if (!parent) return 1;
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    return siblings.indexOf(el) + 1;
  }

  function segmentFor(el: Element): { value: string; anchor: boolean } {
    const tag = el.tagName.toLowerCase();
    if (el.id && !MACHINE_GENERATED_RE.test(el.id)) {
      return { value: `#${el.id}`, anchor: true };
    }
    const dataAttr = firstDataAttribute(el);
    if (dataAttr) return { value: `[${dataAttr}]`, anchor: true };
    const classes = humanClasses(el);
    if (classes.length > 0) return { value: `${tag}.${classes.join(".")}`, anchor: false };
    return { value: `${tag}:nth-of-type(${nthOfType(el)})`, anchor: false };
  }

  function selectorPath(el: Element): string {
    const segments: string[] = [];
    let node: Element | null = el;
    while (
      node &&
      node !== document.body &&
      node !== document.documentElement &&
      segments.length < MAX_SEGMENTS
    ) {
      const segment = segmentFor(node);
      segments.unshift(segment.value);
      if (segment.anchor) break;
      node = node.parentElement;
    }
    return segments.join(" > ");
  }

  const selection = window.getSelection();
  const text = selection ? selection.toString() : "";
  if (!selection || selection.rangeCount === 0 || text.trim().length === 0) {
    return { ok: false, reason: "No text is selected on the page.", cause: "empty" };
  }

  const range = selection.getRangeAt(0);
  let commonAncestor: Node = range.commonAncestorContainer;
  if (commonAncestor.nodeType !== Node.ELEMENT_NODE) {
    commonAncestor = commonAncestor.parentElement ?? commonAncestor;
  }

  // A shadow root or cross-origin iframe: no selector from the top document
  // can ever address it (spec Edge Cases). Fail with an explanation rather
  // than store a selector that can never match.
  if (commonAncestor.getRootNode() !== document) {
    return {
      ok: false,
      reason: "This part of the page can't be scoped.",
      cause: "unscopeable",
    };
  }

  const selector = selectorPath(commonAncestor as Element);
  return { ok: true, text, selector };
}

export async function readLiveSelection(tabId: number): Promise<LiveSelectionOutcome> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readLiveSelectionInPage,
    });
    return (
      (injection?.result as LiveSelectionOutcome | undefined) ?? {
        ok: false,
        reason: "Couldn't read the selection on this page.",
        cause: "empty",
      }
    );
  } catch {
    return {
      ok: false,
      reason: "Couldn't read the selection on this page.",
      cause: "empty",
    };
  }
}
