import type {
  ExtractArgs,
  ExtractionProvenance,
  JobAnalysis,
  PageExtract,
  Salary,
  SalaryPeriod,
  StructuredSource,
} from "../types/job";

/**
 * Extraction payload as produced in the page; canonicalUrl is added by the
 * caller. `structuredSources` and `provenance` are optional on the wire type
 * (older extensions omit them) but always present here — the page either
 * produces them or does not run.
 */
export type RawPageExtract = Omit<
  PageExtract,
  "canonicalUrl" | "structuredSources" | "provenance"
> & {
  structuredSources: StructuredSource[];
  provenance: ExtractionProvenance;
};

/** Cap applied to mainText before transmission (postings are short; cf. 80k video cap). */
export const MAIN_TEXT_CAP = 40_000;

/** Lives in shared/ so the web paste and the server use the same floor (006 research R7). */
export { MIN_TEXT_CHARS } from "../../shared/types/job";

/**
 * Runs inside the target page via chrome.scripting.executeScript({ func, args }).
 * The function is serialized, so it MUST be self-contained: no imports, no
 * references to module scope, no chrome.* (constants are duplicated inline on
 * purpose). Everything it needs from the extension arrives in `args`.
 */
export function extractPage(args: ExtractArgs = {}): Promise<RawPageExtract> {
  const learnedSelector = args.learnedSelector;
  const CAP = 40_000; // keep in sync with MAIN_TEXT_CAP
  const MIN = 300; // keep in sync with MIN_TEXT_CHARS
  /**
   * Hard ceiling on the readiness wait. The corpus's slowest fixture
   * (phenom-intuit) settles at 4883 ms, so anything under ~5 s fails the page
   * that motivated the feature; 6000 ms is that floor plus headroom, and still
   * far inside the 30 s analysis ceiling (constitution IV).
   */
  const BUDGET_MS = 6000;
  /**
   * Quiet period required after text clears MIN. Returning at the first
   * crossing captures ~3% of the Phenom posting: its text crosses 300 at
   * ~3440 ms and keeps growing until ~4280 ms.
   */
  const STABILITY_MS = 400;
  /**
   * Shorter quiet period for a document that was already complete and already
   * had usable text when extraction started. This is the cost charged to the
   * five fixtures that settle in 973-1589 ms, so it is deliberately small.
   */
  const FAST_PATH_MS = 150;
  const POLL_MS = 50;

  const startedAt = Date.now();

  const NOISE_SELECTOR = "nav, header, footer, aside, script, style, noscript";

  function harvestJsonLd(): Record<string, unknown>[] {
    const jsonLd: Record<string, unknown>[] = [];
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of Array.from(scripts)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(script.textContent ?? "");
      } catch {
        continue;
      }
      const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of [...nodes]) {
        if (node && typeof node === "object" && Array.isArray((node as { "@graph"?: unknown[] })["@graph"])) {
          nodes.push(...((node as { "@graph": unknown[] })["@graph"]));
        }
      }
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const type = (node as { "@type"?: unknown })["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.includes("JobPosting")) {
          jsonLd.push(node as Record<string, unknown>);
        }
      }
    }
    return jsonLd;
  }

  function textOf(element: Element): string {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const noise of Array.from(clone.querySelectorAll(NOISE_SELECTOR))) {
      noise.remove();
    }
    const raw: string =
      (clone as { innerText?: string }).innerText ?? clone.textContent ?? "";
    return raw
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  /** class/id substrings that mark chrome rather than posting content (FR-012). */
  const NOISE_KEYWORDS_RE =
    /nav|menu|footer|cookie|consent|banner|sidebar|related|similar|promo|skip/i;

  /** Minimum text length for an element to be considered a scoring candidate. */
  const CANDIDATE_MIN_CHARS = 200;

  function attrsOf(el: Element): string {
    const id = typeof el.id === "string" ? el.id : "";
    const className = typeof el.className === "string" ? el.className : "";
    const role = el.getAttribute("role") ?? "";
    // Frameworks that hash class names for CSS-in-JS (Workday's Emotion
    // classes, e.g. "css-3zv1wr", are opaque) instead carry the semantic
    // label on a data-* attribute (data-automation-id="footerContainer").
    // class/id alone would never see this signal.
    let dataAttrs = "";
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-")) dataAttrs += ` ${attr.value}`;
    }
    return `${id} ${className} ${role}${dataAttrs}`;
  }

  /**
   * Text-density / link-density container scorer (FR-012). Body-fallback
   * loses on 3/6 corpus fixtures today because the three-selector guess has
   * no middle ground between "a semantic container exists" and "swallow the
   * entire body" — this replaces that cliff with a score every element earns.
   *
   * score = textLength * (1 - linkDensity) * penalty
   *
   * `penalty` is 1 for a clean candidate. It drops sharply (0.1) when the
   * candidate itself, or an ancestor up to (not including) <body>, carries a
   * noise-keyword class/id — this is what keeps a cookie-consent dialog's own
   * subtree from ever winning even though its text alone clears the minimum.
   * It also drops proportionally to how much of the candidate's OWN text
   * lives inside a noise-keyword descendant (a skip-link or footer sitting
   * alongside real content inside the same wrapping element) — without this
   * second term, a big-enough wrapper containing both the posting and a
   * banner would still out-score a tighter container purely on raw length,
   * exactly the failure mode a naive length-only scorer has.
   */
  function scoreCandidate(el: Element): { text: string; score: number } | null {
    // NOISE_SELECTOR strips these as DESCENDANTS of some other candidate, but
    // that never disqualifies the noise element itself from being scored AS
    // a candidate — a <script type="application/ld+json"> is plain text with
    // zero link density and no noise-keyword class, so it would otherwise
    // outscore the real content it sits beside.
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
        // Skip a match nested inside an already-counted match, so a banner's
        // own inner divs are not double-charged against the total.
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

  /** JobPosting microdata (`itemscope itemtype=".../JobPosting"`), FR-008. */
  function harvestMicrodata(): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    const roots = Array.from(
      document.querySelectorAll('[itemscope][itemtype*="JobPosting"]')
    );
    for (const root of roots) {
      results.push(readMicrodataItem(root));
    }
    return results;
  }

  function readMicrodataItem(scope: Element): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const el of Array.from(scope.querySelectorAll("[itemprop]"))) {
      // Don't cross into a nested itemscope's own props — read it as one
      // nested object instead of flattening it into the parent.
      let owner: Element | null = el.parentElement;
      let nested = false;
      while (owner && owner !== scope) {
        if (owner.hasAttribute("itemscope")) {
          nested = true;
          break;
        }
        owner = owner.parentElement;
      }
      if (nested) continue;

      const prop = el.getAttribute("itemprop");
      if (!prop) continue;
      const value = el.hasAttribute("itemscope")
        ? readMicrodataItem(el)
        : microdataValueOf(el);
      if (value === null || value === "") continue;
      data[prop] = value;
    }
    return data;
  }

  function microdataValueOf(el: Element): string {
    const tag = el.tagName.toLowerCase();
    if (tag === "meta") return el.getAttribute("content") ?? "";
    if (tag === "a" || tag === "link") return el.getAttribute("href") ?? "";
    if (tag === "img") return el.getAttribute("src") ?? "";
    if (tag === "time") return el.getAttribute("datetime") ?? el.textContent ?? "";
    return (el.textContent ?? "").trim();
  }

  /**
   * One synchronous pass over the current DOM — the whole of what extraction
   * used to be. Pulled into a closure so the readiness loop can call it
   * repeatedly within a single injection: one isolated world, one
   * MutationObserver. Repeated executeScript calls could not share observer
   * state (research R2).
   */
  function attempt(): {
    jsonLd: Record<string, unknown>[];
    mainText: string;
    strategy: RawPageExtract["provenance"]["strategy"];
    structuredSources: StructuredSource[];
    /**
     * Reflects THIS attempt only, never a running/sticky flag: a selector
     * missing at t=0 on a hydrating SPA is not a miss (contract "Interaction
     * with readiness") — if a later attempt within the same readiness cycle
     * succeeds, this must read false again, not stay stuck true from an
     * earlier attempt.
     */
    learnedSelectorMissed: boolean;
  } {
    const jsonLd = harvestJsonLd();
    const microdata = harvestMicrodata();

    const structuredSourcesRaw: StructuredSource[] = [
      ...jsonLd.map((data): StructuredSource => ({ kind: "json-ld", data })),
      ...microdata.map((data): StructuredSource => ({ kind: "microdata", data })),
    ];
    // FR-011: cap total transmitted size, dropping sources whole rather than
    // truncating mid-object — a truncated JSON blob is worse than none.
    const structuredSources: StructuredSource[] = [];
    let structuredSize = 0;
    for (const source of structuredSourcesRaw) {
      const size = JSON.stringify([source]).length;
      if (structuredSize + size > 20_000) continue;
      structuredSources.push(source);
      structuredSize += size;
    }

    // Learned selector (FR-028, FR-029, contracts/learned-selectors.md):
    // applied AHEAD of every automatic strategy, including the Google overlay
    // special case below. A miss here is not necessarily a site redesign — on
    // a hydrating SPA the selector may simply not exist yet at this attempt,
    // which is exactly why this runs inside the readiness loop rather than
    // once before it. The caller (jobFlow.ts) is the one that turns a
    // still-missing selector, after the budget expires, into recordMiss().
    let learnedSelectorMissed = false;
    if (learnedSelector) {
      const learnedEl = document.querySelector(learnedSelector);
      const learnedText = learnedEl ? textOf(learnedEl) : "";
      if (learnedText.length >= MIN) {
        return {
          jsonLd,
          mainText: learnedText,
          strategy: "learned-selector",
          structuredSources,
          learnedSelectorMissed: false,
        };
      }
      learnedSelectorMissed = true;
    }

    // Google's job-detail overlay: the SERP itself is a list page, but the
    // selected posting is rendered inside a visible [role=dialog]. Prefer that
    // dialog's text — read via innerText on the LIVE node, whose layout-aware
    // semantics skip the hidden preloaded detail views of *neighboring* jobs
    // stacked in the same dialog. textOf would leak them: it works on a
    // detached clone, where innerText degrades to textContent and hidden
    // subtrees come back. Scoped to Google search pages: elsewhere a visible
    // dialog is more likely a cookie-consent or chat widget than the posting.
    let overlayText = "";
    if (
      /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(location.hostname) &&
      location.pathname === "/search"
    ) {
      for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]'))) {
        const rect = dialog.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 100) continue;
        const raw: string =
          (dialog as { innerText?: string }).innerText ?? dialog.textContent ?? "";
        const text = raw
          .replace(/[ \t]+/g, " ")
          .replace(/\s*\n\s*/g, "\n")
          .trim();
        if (text.length > overlayText.length) overlayText = text;
      }
    }

    let mainText = "";
    let strategy: RawPageExtract["provenance"]["strategy"] = "semantic";
    if (overlayText.length >= MIN) {
      mainText = overlayText;
      strategy = "google-overlay";
    } else {
      // The semantic container wins OUTRIGHT, verbatim, whenever it clears
      // the minimum — exactly today's behavior (FR-013: "MUST NOT change the
      // selected text on pages where the existing semantic-container path
      // already yields the posting"). This is deliberately a hard rule, not
      // an emergent property of the scorer: greenhouse-discord's and
      // phenom-intuit's own <main> legitimately contains some
      // noise-keyword-matched material today (a "related jobs" rail is
      // *inside* phenom's <main>, not a sibling of it) that any density
      // penalty strong enough to fix Workday's footer would also strip from
      // these two protected fixtures, changing their byte count and failing
      // FR-013. Scoring therefore only runs — per FR-012's first clause —
      // when the semantic path "yields nothing" (or below-minimum text);
      // FR-012's second clause ("or yields a container that scores worse")
      // is not exercised by any corpus fixture and is intentionally left
      // unimplemented rather than tuned against nothing.
      let semanticText = "";
      for (const selector of ["main", "[role=main]", "article"]) {
        const el = document.querySelector(selector);
        if (el) {
          const text = textOf(el);
          if (text.length > semanticText.length) semanticText = text;
        }
      }

      if (semanticText.length >= MIN) {
        mainText = semanticText;
        strategy = "semantic";
      } else {
        let bestScore = -1;
        let bestText = "";

        if (document.body) {
          for (const el of Array.from(document.body.querySelectorAll("*"))) {
            const evaluated = scoreCandidate(el);
            if (!evaluated) continue;
            if (evaluated.score > bestScore) {
              bestScore = evaluated.score;
              bestText = evaluated.text;
            }
          }
        }

        if (bestText.length >= MIN) {
          mainText = bestText;
          strategy = "scored";
        } else if (document.body) {
          const bodyText = textOf(document.body);
          if (bodyText.length > mainText.length) {
            mainText = bodyText;
            strategy = "body";
          }
        }
      }
    }

    return { jsonLd, mainText, strategy, structuredSources, learnedSelectorMissed };
  }

  return new Promise<RawPageExtract>((resolve) => {
    let attempts = 0;
    let latest = attempt();
    attempts += 1;

    /**
     * Readiness keys on BODY TEXT ONLY.
     *
     * The old predicate was `jsonLd.length > 0 || text >= 300`, which passes on
     * JSON-LD alone before any body text exists — on 3 of 6 corpus fixtures it
     * fires while mainText is still empty (Workday at 8 ms with text at 736 ms,
     * Ashby at 10 ms / 369 ms, Phenom at 3314 ms / 3440 ms). A retry loop built
     * on it would return instantly with an empty body and be no better than
     * shipping nothing. Structured data must not satisfy readiness (FR-001),
     * and we must not return below-minimum text while budget remains (FR-004a).
     */
    const hasUsableText = (): boolean => latest.mainText.length >= MIN;

    // A document that was already complete with usable text on the first pass
    // gets the short quiet period. Any observed mutation means the page is
    // still building, so it graduates to the full stability window.
    let quietNeeded =
      document.readyState === "complete" && hasUsableText() ? FAST_PATH_MS : STABILITY_MS;

    let lastGrowthAt = Date.now();
    let dirty = false;

    const observer = new MutationObserver(() => {
      dirty = true;
      if (quietNeeded === FAST_PATH_MS) quietNeeded = STABILITY_MS;
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const finish = (budgetExpired: boolean): void => {
      observer.disconnect();
      clearInterval(timer);
      resolve({
        url: location.href,
        title: document.title,
        jsonLd: latest.jsonLd,
        structuredSources: latest.structuredSources,
        mainText: latest.mainText.slice(0, CAP),
        extractedAt: new Date().toISOString(),
        provenance: {
          strategy: latest.strategy,
          attempts,
          elapsedMs: Date.now() - startedAt,
          budgetExpired,
          learnedSelectorMissed: latest.learnedSelectorMissed,
        },
      });
    };

    const timer = setInterval(() => {
      // Re-attempt only when something actually changed. attempt() clones and
      // walks subtrees, so polling it unconditionally would burn CPU on every
      // page for the whole budget.
      if (dirty) {
        dirty = false;
        const previousLength = latest.mainText.length;
        latest = attempt();
        attempts += 1;
        if (latest.mainText.length > previousLength) lastGrowthAt = Date.now();
      }

      if (hasUsableText() && Date.now() - lastGrowthAt >= quietNeeded) {
        finish(false);
        return;
      }
      if (Date.now() - startedAt >= BUDGET_MS) finish(true);
    }, POLL_MS);

    // A page that is already settled still has to clear its quiet period, but
    // nothing else is pending, so the first interval tick resolves it.
  });
}

/**
 * Client-side fallback fields derived from schema.org JobPosting JSON-LD.
 * Rendered when the backend is unreachable so the panel is never empty-handed.
 */
export function deriveJsonLdFields(
  jsonLd: Record<string, unknown>[]
): Partial<JobAnalysis> {
  const posting = jsonLd[0];
  if (!posting) return {};

  const fields: Partial<JobAnalysis> = {
    title: stringOrNull(posting["title"]),
    company: orgName(posting["hiringOrganization"]),
    location: locationText(posting["jobLocation"]),
    salary: salaryOf(posting["baseSalary"]),
  };

  const locationType = posting["jobLocationType"];
  const locationTypes = Array.isArray(locationType) ? locationType : [locationType];
  if (locationTypes.includes("TELECOMMUTE")) {
    fields.arrangement = "remote";
    fields.arrangementConfidence = "explicit";
  }

  return fields;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function orgName(org: unknown): string | null {
  if (typeof org === "string") return org || null;
  if (org && typeof org === "object") {
    return stringOrNull((org as Record<string, unknown>)["name"]);
  }
  return null;
}

function locationText(location: unknown): string | null {
  const place = Array.isArray(location) ? location[0] : location;
  if (typeof place === "string") return place || null;
  if (!place || typeof place !== "object") return null;
  const address = (place as Record<string, unknown>)["address"];
  if (typeof address === "string") return address || null;
  if (!address || typeof address !== "object") return null;
  const parts = ["addressLocality", "addressRegion", "addressCountry"]
    .map((key) => (address as Record<string, unknown>)[key])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

function salaryOf(baseSalary: unknown): Salary | null {
  if (!baseSalary || typeof baseSalary !== "object") return null;
  const salary = baseSalary as Record<string, unknown>;
  const value = salary["value"];
  const valueObj =
    value && typeof value === "object" ? (value as Record<string, unknown>) : salary;

  const min = numberOrNull(valueObj["minValue"] ?? valueObj["value"]);
  const max = numberOrNull(valueObj["maxValue"]);
  const currency = stringOrNull(salary["currency"]);
  const period = periodOf(valueObj["unitText"]);
  if (min === null && max === null && currency === null) return null;
  return { min, max, currency, period };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function periodOf(unitText: unknown): SalaryPeriod | null {
  if (typeof unitText !== "string") return null;
  const map: Record<string, SalaryPeriod> = {
    YEAR: "year",
    MONTH: "month",
    DAY: "day",
    HOUR: "hour",
  };
  return map[unitText.toUpperCase()] ?? null;
}
