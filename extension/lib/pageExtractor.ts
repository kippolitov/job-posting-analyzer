import type { JobAnalysis, PageExtract, Salary, SalaryPeriod } from "../types/job";

/** Extraction payload as produced in the page; canonicalUrl is added by the caller. */
export type RawPageExtract = Omit<PageExtract, "canonicalUrl">;

/** Cap applied to mainText before transmission (postings are short; cf. 80k video cap). */
export const MAIN_TEXT_CAP = 40_000;

/** Below this many characters (with no JSON-LD) the page is not worth analyzing. */
export const MIN_TEXT_CHARS = 300;

/**
 * Runs inside the target page via chrome.scripting.executeScript({ func }).
 * The function is serialized, so it MUST be self-contained: no imports, no
 * references to module scope (constants are duplicated inline on purpose).
 */
export function extractPage(): RawPageExtract {
  const CAP = 40_000; // keep in sync with MAIN_TEXT_CAP

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

  const NOISE_SELECTOR = "nav, header, footer, aside, script, style, noscript";

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

  let mainText = "";
  for (const selector of ["main", "[role=main]", "article"]) {
    const candidate = document.querySelector(selector);
    if (candidate) {
      const text = textOf(candidate);
      if (text.length > mainText.length) mainText = text;
    }
  }
  if (mainText.length < 300 && document.body) {
    const bodyText = textOf(document.body);
    if (bodyText.length > mainText.length) mainText = bodyText;
  }

  return {
    url: location.href,
    title: document.title,
    jsonLd,
    mainText: mainText.slice(0, CAP),
    extractedAt: new Date().toISOString(),
  };
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
