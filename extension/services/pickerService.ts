/**
 * Backs the manual "Analyze a region" flow (spec FR-023, FR-024, FR-024a) —
 * both the pointer overlay and the panel's keyboard candidate list feed
 * through here, since FR-024b requires the two paths to see the same
 * candidates and the same measure of each.
 *
 * Every operation below is one `chrome.scripting.executeScript` call into a
 * single self-contained dispatch function, `pickerPageScript`. It is
 * serialized by `func.toString()` and runs in an isolated world with no
 * access to this module's scope (research R2, and the same constraint
 * `extractPage` and `selectionService.ts` document) — so every helper it
 * needs (the FR-012 scorer from `lib/pageExtractor.ts`'s `scoreCandidate`,
 * the selector-path logic from `lib/selectorPath.ts`) is duplicated as a
 * nested function INSIDE it, the same documented exception plan.md records
 * for `extension/scripts/corpusProbe.ts`. Folding every command (list,
 * highlight, clear, resolve, pointer-pick) into ONE dispatch function keeps
 * that duplication to a single copy rather than one per entry point.
 */

/** One candidate the scorer considered, ranked (FR-024b: label, length, excerpt). */
export interface PickerCandidate {
  selector: string;
  label: string;
  textLength: number;
  excerpt: string;
}

export type CommitOutcome = { ok: true; text: string } | { ok: false; reason: string };

export type PointerPickOutcome =
  | { ok: true; text: string; selector: string }
  | { ok: false; reason: string };

export type PickerCommand =
  | { type: "beginSession" }
  | { type: "list" }
  | { type: "highlight"; selector: string }
  | { type: "clearHighlight" }
  | { type: "resolveText"; selector: string }
  | { type: "pointerPick" }
  | { type: "cancelPointerPick" };

export type PickerPageResult =
  | { kind: "candidates"; candidates: PickerCandidate[] }
  | { kind: "void" }
  | { kind: "commit"; outcome: CommitOutcome }
  | { kind: "pointerPick"; outcome: PointerPickOutcome };

/**
 * Runs inside the target page via executeScript. Self-contained by the same
 * rule as `extractPage` — exported so it can be unit-tested directly (jsdom
 * has no `innerText`, so length/ordering assertions use the `textContent`
 * fallback, same tradeoff research R9 documents for the extractor tests).
 */
export async function pickerPageScript(command: PickerCommand): Promise<PickerPageResult> {
  const NOISE_SELECTOR = "nav, header, footer, aside, script, style, noscript";
  const NOISE_KEYWORDS_RE =
    /nav|menu|footer|cookie|consent|banner|sidebar|related|similar|promo|skip/i;
  const CANDIDATE_MIN_CHARS = 200;
  const MACHINE_GENERATED_RE = /^(css|sc|jsx|emotion)-|[-_][a-z0-9]{5,}$/i;
  const MAX_SEGMENTS = 4;
  const EXCERPT_MAX = 120;
  const HIGHLIGHT_ATTR = "data-jpa-picker-highlight";
  const CURSOR_BADGE_ID = "jpa-picker-cursor-badge";
  // Cap on the ranked list shown in the panel (FR-024b) — enough to cover
  // every corpus fixture's real candidates without overwhelming a
  // screen-reader user. Must live INSIDE this function: it is serialized by
  // `func.toString()` for executeScript, and a module-scope const referenced
  // from here is a ReferenceError at runtime, not a closure capture.
  const MAX_CANDIDATES = 8;

  function textOf(element: Element): string {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const noise of Array.from(clone.querySelectorAll(NOISE_SELECTOR))) {
      noise.remove();
    }
    const raw: string = (clone as { innerText?: string }).innerText ?? clone.textContent ?? "";
    return raw
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  function attrsOf(el: Element): string {
    const id = typeof el.id === "string" ? el.id : "";
    const className = typeof el.className === "string" ? el.className : "";
    const role = el.getAttribute("role") ?? "";
    let dataAttrs = "";
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-")) dataAttrs += ` ${attr.value}`;
    }
    return `${id} ${className} ${role}${dataAttrs}`;
  }

  // Duplicated from lib/pageExtractor.ts's scoreCandidate (FR-012) — ranking
  // shown to a hand-scoping user must match what the automatic path would
  // have picked, per FR-024b.
  function scoreCandidate(el: Element): { text: string; score: number } | null {
    if (el.matches(NOISE_SELECTOR)) return null;
    const text = textOf(el);
    if (text.length < CANDIDATE_MIN_CHARS) return null;

    const clone = el.cloneNode(true) as HTMLElement;
    for (const noise of Array.from(clone.querySelectorAll(NOISE_SELECTOR))) {
      noise.remove();
    }
    let anchorLength = 0;
    for (const anchor of Array.from(clone.querySelectorAll("a"))) {
      anchorLength += (anchor.textContent ?? "").length;
    }
    const linkDensity = text.length > 0 ? Math.min(1, anchorLength / text.length) : 0;

    let selfOrAncestorNoisy = false;
    for (
      let node: Element | null = el;
      node && node !== document.body && node !== document.documentElement;
      node = node.parentElement
    ) {
      if (NOISE_KEYWORDS_RE.test(attrsOf(node))) {
        selfOrAncestorNoisy = true;
        break;
      }
    }

    let noiseDescendantLength = 0;
    if (!selfOrAncestorNoisy) {
      const seen = new Set<Element>();
      for (const descendant of Array.from(clone.querySelectorAll("*"))) {
        if (!NOISE_KEYWORDS_RE.test(attrsOf(descendant))) continue;
        let counted = false;
        for (const seenEl of seen) {
          if (seenEl.contains(descendant)) {
            counted = true;
            break;
          }
        }
        if (counted) continue;
        seen.add(descendant);
        noiseDescendantLength += textOf(descendant).length;
      }
    }
    const noiseFraction = text.length > 0 ? noiseDescendantLength / text.length : 0;
    const penalty = selfOrAncestorNoisy ? 0.1 : Math.max(0.15, 1 - noiseFraction);
    const score = text.length * (1 - linkDensity) * penalty;
    return { text, score };
  }

  // Duplicated from lib/selectorPath.ts — see file header for why.
  function humanClasses(el: Element): string[] {
    return Array.from(el.classList).filter((c) => c.length > 0 && !MACHINE_GENERATED_RE.test(c));
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
    if (el.id && !MACHINE_GENERATED_RE.test(el.id)) return { value: `#${el.id}`, anchor: true };
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

  function excerptOf(text: string): string {
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed.length <= EXCERPT_MAX) return collapsed;
    const cut = collapsed.slice(0, EXCERPT_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
  }

  function labelFor(el: Element): string {
    const tag = el.tagName.toLowerCase();
    if (tag === "main" || el.getAttribute("role") === "main") return "Main content";
    if (tag === "article") return "Article";
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim().length > 0) return aria.trim().slice(0, 40);
    const humanCls = humanClasses(el)[0];
    if (humanCls) return humanCls.replace(/[-_]+/g, " ").trim();
    const dataAttr = firstDataAttribute(el);
    if (dataAttr) return dataAttr.replace(/^data-/, "").replace(/[-_]+/g, " ").trim();
    return "Block";
  }

  /** Elements considered candidates, same set the extractor's scorer walks. */
  function candidateElements(): Element[] {
    const els: Element[] = [];
    for (const selector of ["main", "[role=main]", "article"]) {
      const el = document.querySelector(selector);
      if (el) els.push(el);
    }
    if (document.body) {
      for (const el of Array.from(document.body.querySelectorAll("*"))) els.push(el);
    }
    return els;
  }

  function rankCandidates(): { el: Element; text: string; score: number }[] {
    const scored: { el: Element; text: string; score: number }[] = [];
    const seen = new Set<Element>();
    for (const el of candidateElements()) {
      if (seen.has(el)) continue;
      seen.add(el);
      const evaluated = scoreCandidate(el);
      if (evaluated) scored.push({ el, ...evaluated });
    }
    scored.sort((a, b) => b.score - a.score);

    // Dedupe near-identical nested wrappers (a <div> whose only child is the
    // real candidate scores almost the same and would otherwise double the
    // list with no new information for the user, spec FR-024b).
    const kept: { el: Element; text: string; score: number }[] = [];
    for (const candidate of scored) {
      const isNearDuplicate = kept.some((k) => {
        const related = k.el.contains(candidate.el) || candidate.el.contains(k.el);
        if (!related) return false;
        const ratio = candidate.text.length / Math.max(1, k.text.length);
        return ratio > 0.85 && ratio < 1.15;
      });
      if (!isNearDuplicate) kept.push(candidate);
      if (kept.length >= MAX_CANDIDATES) break;
    }
    return kept;
  }

  function listCandidates(): PickerCandidate[] {
    return rankCandidates().map(({ el, text }) => ({
      selector: selectorPath(el),
      label: labelFor(el),
      textLength: text.length,
      excerpt: excerptOf(text),
    }));
  }

  // Removes only the highlight styling/badge — called on every hover or
  // arrow-key move to swap the highlighted candidate. It must NOT touch
  // scroll position or the stored-origin flag below, or repeated moves would
  // each capture a new "original" and FR-025's restore-on-dismiss would
  // restore to the wrong place.
  function clearHighlightVisuals(): void {
    for (const el of Array.from(document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`))) {
      (el as HTMLElement).style.outline = "";
      (el as HTMLElement).style.outlineOffset = "";
      (el as HTMLElement).style.boxShadow = "";
      el.removeAttribute(HIGHLIGHT_ATTR);
    }
    document.getElementById(CURSOR_BADGE_ID)?.remove();
    document.body.style.cursor = "";
  }

  // Captures the CURRENT scroll position as the one FR-025 restores to on
  // dismissal — but only if a session hasn't already captured one, so
  // repeated calls during one session (one per hovered/highlighted
  // candidate) never overwrite it with an already-scrolled position.
  function rememberOriginalScroll(): void {
    const globalScope = window as unknown as Record<string, unknown>;
    if (globalScope.__jpaPickerOriginalScroll === undefined) {
      globalScope.__jpaPickerOriginalScroll = { x: window.scrollX, y: window.scrollY };
    }
  }

  // Explicit session boundary: forces a fresh capture even if a PRIOR
  // session left one behind without going through clearHighlight (e.g. the
  // panel was closed without Escape/commit while the page never navigated,
  // so this page context — and any leftover flag — survived). Called once
  // by the caller when scoping actually begins, before the first highlight
  // or the pointer picker starts.
  function beginSession(): void {
    clearHighlightVisuals();
    const globalScope = window as unknown as Record<string, unknown>;
    delete globalScope.__jpaPickerOriginalScroll;
    rememberOriginalScroll();
  }

  // The actual "dismiss without side effects" endpoint (FR-025, T101):
  // visuals gone AND scroll restored to what it was when scoping started.
  function clearHighlight(): void {
    clearHighlightVisuals();
    const globalScope = window as unknown as Record<string, unknown>;
    const stored = globalScope.__jpaPickerOriginalScroll as { x: number; y: number } | undefined;
    if (stored) {
      window.scrollTo(stored.x, stored.y);
      delete globalScope.__jpaPickerOriginalScroll;
    }
  }

  // FR-024c: perceivable without relying on color alone (a shape/outline
  // change, not a color shift) and 3:1 against arbitrary page content —
  // achieved with a white+blue double ring via boxShadow rather than a flat
  // color, since a flat color chosen once cannot stay contrasty against
  // unknown page backgrounds.
  function applyHighlight(el: Element): void {
    clearHighlightVisuals();
    const node = el as HTMLElement;
    node.style.outline = "3px solid #2563eb";
    node.style.outlineOffset = "2px";
    node.style.boxShadow = "0 0 0 2px #ffffff, 0 0 0 5px #2563eb";
    node.setAttribute(HIGHLIGHT_ATTR, "true");
  }

  function highlightBySelector(selector: string): void {
    rememberOriginalScroll();
    const el = document.querySelector(selector);
    if (!el) return;
    applyHighlight(el);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // FR-024b's stale-list edge case (spec Edge Cases): the list was built at
  // some earlier moment, so re-resolve at commit time rather than trust it.
  function resolveText(selector: string): CommitOutcome {
    const el = document.querySelector(selector);
    if (!el) {
      return { ok: false, reason: "This region is no longer on the page. Choose another one from the list." };
    }
    const text = textOf(el);
    if (text.length < 200) {
      return { ok: false, reason: "This region is no longer on the page. Choose another one from the list." };
    }
    return { ok: true, text };
  }

  // FR-024/FR-024c/FR-025/T100/T101: pointer path. Highlights the block
  // under the cursor with its live character count, commits on click
  // (re-resolving the node at click time per the same re-render edge case),
  // and on Escape restores scroll, cursor, and highlight styling exactly as
  // found — "dismissible without side effects."
  function pointerPick(): Promise<PointerPickOutcome> {
    return new Promise((resolve) => {
      beginSession();
      document.body.style.cursor = "crosshair";

      function blockUnder(x: number, y: number): Element | null {
        let node = document.elementFromPoint(x, y);
        while (node && node !== document.body) {
          if (textOf(node).length >= CANDIDATE_MIN_CHARS || node.parentElement === document.body) {
            return node;
          }
          node = node.parentElement;
        }
        return node;
      }

      function showBadge(x: number, y: number, length: number): void {
        let badge = document.getElementById(CURSOR_BADGE_ID);
        if (!badge) {
          badge = document.createElement("div");
          badge.id = CURSOR_BADGE_ID;
          badge.style.position = "fixed";
          badge.style.zIndex = "2147483647";
          badge.style.pointerEvents = "none";
          badge.style.background = "#111827";
          badge.style.color = "#ffffff";
          badge.style.font = "11px sans-serif";
          badge.style.padding = "2px 6px";
          badge.style.borderRadius = "4px";
          document.body.appendChild(badge);
        }
        badge.textContent = `${length.toLocaleString()} chars`;
        badge.style.left = `${x + 12}px`;
        badge.style.top = `${y + 12}px`;
      }

      const onMouseMove = (e: MouseEvent): void => {
        const target = blockUnder(e.clientX, e.clientY);
        if (target) {
          applyHighlight(target);
          showBadge(e.clientX, e.clientY, textOf(target).length);
        }
      };

      // A successful commit clears the highlight but leaves scroll where the
      // user clicked — FR-025's restore-on-dismiss applies to abandoning
      // selection, not to completing it. Escape and "nothing found" ARE
      // dismissals, so both restore scroll via the full clearHighlight().
      // Also drops the cross-invocation cancel handle below: once this
      // promise is settling, an external "cancelPointerPick" call from a
      // LATER, separate executeScript invocation must no longer reach in.
      const cleanup = (restoreScroll: boolean): void => {
        document.removeEventListener("mousemove", onMouseMove, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKeyDown, true);
        if (restoreScroll) clearHighlight();
        else clearHighlightVisuals();
        delete (window as unknown as Record<string, unknown>).__jpaPickerCancelPointerPick;
      };

      const onClick = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        const target = blockUnder(e.clientX, e.clientY);
        if (!target) {
          cleanup(true);
          resolve({ ok: false, reason: "No region was found at that point." });
          return;
        }
        const text = textOf(target);
        const selector = selectorPath(target);
        cleanup(false);
        resolve({ ok: true, text, selector });
      };

      const dismiss = (): void => {
        cleanup(true);
        resolve({ ok: false, reason: "dismissed" });
      };

      const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== "Escape") return;
        dismiss();
      };

      // Each executeScript call is a fresh invocation with its OWN closure —
      // a later "cancelPointerPick" call cannot reach this promise's resolve
      // directly. Stashing `dismiss` on `window` (the one thing that DOES
      // persist across separate injections into the same page, same
      // technique the remembered-scroll flag above uses) is what lets the
      // panel cancel an in-flight pointer session without the user having
      // pressed Escape on the page itself — e.g. clicking "Use the list
      // instead" or "Cancel" back in the panel.
      (window as unknown as Record<string, unknown>).__jpaPickerCancelPointerPick = dismiss;

      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeyDown, true);
    });
  }

  function cancelPointerPick(): void {
    const globalScope = window as unknown as Record<string, unknown>;
    const dismiss = globalScope.__jpaPickerCancelPointerPick as (() => void) | undefined;
    dismiss?.();
  }

  switch (command.type) {
    case "beginSession":
      beginSession();
      return { kind: "void" };
    case "list":
      return { kind: "candidates", candidates: listCandidates() };
    case "highlight":
      highlightBySelector(command.selector);
      return { kind: "void" };
    case "clearHighlight":
      clearHighlight();
      return { kind: "void" };
    case "resolveText":
      return { kind: "commit", outcome: resolveText(command.selector) };
    case "pointerPick":
      return { kind: "pointerPick", outcome: await pointerPick() };
    case "cancelPointerPick":
      cancelPointerPick();
      return { kind: "void" };
    default:
      return { kind: "void" };
  }
}

/**
 * Marks the start of a scoping session — called once by the panel before
 * the first candidate is listed/highlighted or the pointer picker starts.
 * Forces a fresh scroll-origin capture even if a prior session on this same
 * page left one behind without an explicit dismiss (see `beginSession`'s
 * in-page comment).
 */
async function beginSession(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: pickerPageScript,
      args: [{ type: "beginSession" }],
    });
  } catch {
    // Best-effort — worst case a later dismiss restores to a slightly
    // stale position, which is cosmetic.
  }
}

async function listCandidates(tabId: number): Promise<PickerCandidate[]> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pickerPageScript,
      args: [{ type: "list" }],
    });
    const result = injection?.result as PickerPageResult | undefined;
    return result?.kind === "candidates" ? result.candidates : [];
  } catch {
    return [];
  }
}

async function highlightCandidate(tabId: number, selector: string): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: pickerPageScript,
      args: [{ type: "highlight", selector }],
    });
  } catch {
    // Best-effort visual supplement (FR-024b) — a screen-reader user does
    // not depend on it, so a failure here is silent.
  }
}

async function clearPickerHighlight(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: pickerPageScript,
      args: [{ type: "clearHighlight" }],
    });
  } catch {
    // Page may already be gone (navigation) — nothing to restore.
  }
}

async function resolveCandidateText(tabId: number, selector: string): Promise<CommitOutcome> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pickerPageScript,
      args: [{ type: "resolveText", selector }],
    });
    const result = injection?.result as PickerPageResult | undefined;
    if (result?.kind === "commit") return result.outcome;
    return { ok: false, reason: "This region is no longer on the page. Choose another one from the list." };
  } catch {
    return { ok: false, reason: "This region is no longer on the page. Choose another one from the list." };
  }
}

async function startPointerPick(tabId: number): Promise<PointerPickOutcome> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pickerPageScript,
      args: [{ type: "pointerPick" }],
    });
    const result = injection?.result as PickerPageResult | undefined;
    if (result?.kind === "pointerPick") return result.outcome;
    return { ok: false, reason: "dismissed" };
  } catch {
    return { ok: false, reason: "dismissed" };
  }
}

/**
 * Cancels an in-flight `startPointerPick` from OUTSIDE the page — e.g. the
 * panel's own "Cancel"/"Use the list instead" controls, where no Escape
 * keydown ever reaches the page. A separate executeScript call reaching the
 * still-pending one via the `window`-stashed handle in `pointerPick` (see
 * its in-page comment) — without this, that promise would never resolve and
 * the page would be left in crosshair mode with live listeners forever.
 */
async function cancelPointerPick(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: pickerPageScript,
      args: [{ type: "cancelPointerPick" }],
    });
  } catch {
    // Page may already be gone (navigation) — the pending promise, if any,
    // died with it.
  }
}

export const pickerService = {
  beginSession,
  listCandidates,
  highlightCandidate,
  clearPickerHighlight,
  resolveCandidateText,
  startPointerPick,
  cancelPointerPick,
};
