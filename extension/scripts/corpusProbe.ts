/**
 * Page-context probe shared by captureCorpus.ts and evalExtraction.ts
 * (specs/005-resilient-extraction/spec.md — Measurement Corpus).
 *
 * `probeSource` is the *source text* of a self-contained function, injected
 * with page.evaluate. It deliberately duplicates the shipped extractor's
 * container logic instead of importing it: extension/lib/pageExtractor.ts is
 * serialized into the page by chrome.scripting.executeScript and cannot be
 * imported here either. Keeping the duplication in one string — rather than
 * scattered across two scripts — is the cheapest way to keep the baseline
 * honest about what the extension actually does today.
 *
 * If pageExtractor.ts's container selection changes, this must change with it,
 * or the "baseline" it reports stops describing the shipped behavior.
 */

/** Mirrors MIN_TEXT_CHARS in extension/lib/pageExtractor.ts. */
export const MIN_TEXT_CHARS = 300;

export interface Probe {
  /** JSON-LD JobPosting nodes found (current extractor's only structured signal). */
  jsonLdCount: number;
  /** Length of the text the current extractor would select. */
  textLen: number;
  /** Which container the current extractor would have used. */
  strategy: "semantic" | "body" | "google-overlay" | "none";
  /**
   * The CURRENT extractor's usable-content test. Measured to pass on JSON-LD
   * alone while body text is still empty — see the corpus README.
   */
  ready: boolean;
  /** Body text alone cleared the minimum — what a corrected predicate needs. */
  textReady: boolean;
  /** Globals / inline scripts whose payload looks like posting data. */
  discovered: { where: string; bytes: number }[];
  /** Structured signals the current extractor ignores (SC-003 baseline). */
  signals: {
    microdata: number;
    nextData: boolean;
    nuxtData: boolean;
    remixContext: boolean;
    phenomDdo: boolean;
    initialState: boolean;
  };
  /** First 200 chars of selected text — for eyeballing wrong-region picks. */
  head: string;
}

/**
 * Playwright evaluates a string as an *expression*, so the probe is handed to
 * page.evaluate as `PROBE_EXPR` (an immediately-invoked wrapper), never as the
 * bare function source.
 */
export const probeSource = `() => {
  const NOISE = "nav, header, footer, aside, script, style, noscript";
  const clean = (s) => s.replace(/[ \\t]+/g, " ").replace(/\\s*\\n\\s*/g, "\\n").trim();

  function textOf(element) {
    const clone = element.cloneNode(true);
    for (const noise of Array.from(clone.querySelectorAll(NOISE))) noise.remove();
    return clean(clone.innerText ?? clone.textContent ?? "");
  }

  // --- JSON-LD JobPosting (verbatim from pageExtractor.ts) ---
  const jsonLd = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    let parsed;
    try { parsed = JSON.parse(script.textContent ?? ""); } catch { continue; }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of [...nodes]) {
      if (node && typeof node === "object" && Array.isArray(node["@graph"])) nodes.push(...node["@graph"]);
    }
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const type = node["@type"];
      const types = Array.isArray(type) ? type : [type];
      if (types.includes("JobPosting")) jsonLd.push(node);
    }
  }

  // --- container selection (verbatim from pageExtractor.ts) ---
  let overlayText = "";
  if (/(^|\\.)google\\.[a-z]{2,3}(\\.[a-z]{2})?$/.test(location.hostname) && location.pathname === "/search") {
    for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]'))) {
      const rect = dialog.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) continue;
      const text = clean(dialog.innerText ?? dialog.textContent ?? "");
      if (text.length > overlayText.length) overlayText = text;
    }
  }

  let mainText = "";
  let strategy = "none";
  if (overlayText.length >= 300) {
    mainText = overlayText;
    strategy = "google-overlay";
  } else {
    for (const selector of ["main", "[role=main]", "article"]) {
      const candidate = document.querySelector(selector);
      if (candidate) {
        const text = textOf(candidate);
        if (text.length > mainText.length) { mainText = text; strategy = "semantic"; }
      }
    }
    if (mainText.length < 300 && document.body) {
      const bodyText = textOf(document.body);
      if (bodyText.length > mainText.length) { mainText = bodyText; strategy = "body"; }
    }
  }

  // --- signals the current extractor ignores ---
  const microdata = document.querySelectorAll('[itemtype*="JobPosting"]').length;
  const hasScript = (id) => Boolean(document.getElementById(id));
  const w = window;

  // Empirical blob discovery. The named conventions below are folklore until a
  // corpus page actually exhibits one, so we ALSO scan every global and inline
  // script for a payload that looks like posting data. This is what turns
  // "which state blobs matter?" from a guess into a measurement.
  const POSTING_MARKER = /"(JobPosting|jobDescription|jobTitle|job_description)"/;
  const discovered = [];

  for (const key of Object.keys(w)) {
    if (/^(window|self|top|parent|frames|document|location|navigator)$/.test(key)) continue;
    let value;
    try { value = w[key]; } catch { continue; }
    if (!value || typeof value !== "object") continue;
    let json;
    try { json = JSON.stringify(value); } catch { continue; }   // circular / huge
    if (!json || json.length < 200 || json.length > 8000000) continue;
    if (POSTING_MARKER.test(json)) discovered.push({ where: "window." + key, bytes: json.length });
  }

  for (const s of Array.from(document.querySelectorAll("script"))) {
    if ((s.getAttribute("type") || "") === "application/ld+json") continue; // already counted
    const text = s.textContent || "";
    if (text.length < 200 || !POSTING_MARKER.test(text)) continue;
    discovered.push({ where: "script " + (s.id ? "#" + s.id : "(inline)"), bytes: text.length });
  }

  return {
    jsonLdCount: jsonLd.length,
    textLen: mainText.length,
    strategy: mainText.length === 0 ? "none" : strategy,
    // The CURRENT extractor's predicate, kept verbatim for baseline comparison.
    // Note it passes on JSON-LD alone, even with zero body text.
    ready: jsonLd.length > 0 || mainText.length >= 300,
    // What a corrected predicate must require: actual usable body text.
    textReady: mainText.length >= 300,
    discovered: discovered.slice(0, 12),
    signals: {
      microdata,
      nextData: hasScript("__NEXT_DATA__"),
      nuxtData: hasScript("__NUXT_DATA__"),
      remixContext: typeof w.__remixContext !== "undefined",
      phenomDdo: Boolean(w.phApp && w.phApp.ddo),
      initialState: typeof w.__INITIAL_STATE__ !== "undefined" || typeof w.__initialState !== "undefined",
    },
    head: mainText.slice(0, 200),
  };
}`;

/** The probe as an immediately-invoked expression, ready for page.evaluate. */
export const PROBE_EXPR = `(${probeSource})()`;
