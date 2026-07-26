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

/** Below this many characters (with no JSON-LD) the page is not worth analyzing. */
export const MIN_TEXT_CHARS = 300;

/**
 * Runs inside the target page via chrome.scripting.executeScript({ func, args }).
 * The function is serialized, so it MUST be self-contained: no imports, no
 * references to module scope, no chrome.* (constants are duplicated inline on
 * purpose). Everything it needs from the extension arrives in `args`.
 */
export function extractPage(_args: ExtractArgs = {}): Promise<RawPageExtract> {
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
  } {
    const jsonLd = harvestJsonLd();

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
      for (const selector of ["main", "[role=main]", "article"]) {
        const candidate = document.querySelector(selector);
        if (candidate) {
          const text = textOf(candidate);
          if (text.length > mainText.length) mainText = text;
        }
      }
      if (mainText.length < MIN && document.body) {
        const bodyText = textOf(document.body);
        if (bodyText.length > mainText.length) {
          mainText = bodyText;
          strategy = "body";
        }
      }
    }

    return { jsonLd, mainText, strategy };
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
        structuredSources: [],
        mainText: latest.mainText.slice(0, CAP),
        extractedAt: new Date().toISOString(),
        provenance: {
          strategy: latest.strategy,
          attempts,
          elapsedMs: Date.now() - startedAt,
          budgetExpired,
          learnedSelectorMissed: false,
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
