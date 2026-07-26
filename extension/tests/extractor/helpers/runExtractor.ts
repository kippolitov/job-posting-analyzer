import type { Page } from "@playwright/test";
import { extractPage } from "../../../lib/pageExtractor";
import type { RawPageExtract } from "../../../lib/pageExtractor";
import type { ExtractArgs } from "../../../types/job";

/**
 * Evaluates the real `extractPage` inside a real Chromium page.
 *
 * This is the lane research R9 requires. jsdom implements no `innerText`, so
 * every extractor assertion in vitest silently exercises the `textContent`
 * fallback branch — a different code path from the one that ships. Anything
 * touching innerText, layout, or the corpus has to be asserted here.
 *
 * `page.evaluate(fn, arg)` serializes the function exactly as
 * `chrome.scripting.executeScript({ func, args })` does, and awaits a returned
 * promise the same way, so this harness exercises the shipping call shape
 * rather than an approximation of it.
 */
export async function runExtractor(
  page: Page,
  args: ExtractArgs = {}
): Promise<RawPageExtract> {
  await installKeepNamesShim(page);
  return page.evaluate(extractPage, args);
}

/**
 * Defines the `__name` helper esbuild emits under `keepNames`.
 *
 * tsx and Playwright both transform TypeScript with esbuild's keepNames on, so
 * every function declaration compiles to `__name(fn, "fn")`. That helper lives
 * in the module scope the serialized function leaves behind, so evaluating
 * extractPage in the page throws `ReferenceError: __name is not defined`.
 *
 * This is a transform artifact, not a product defect: the shipped bundle is
 * built by vite with keepNames off, and `output/chrome-mv3/background.js`
 * contains no `__name` reference. The shim exists so the harness tests the
 * extractor rather than the toolchain around it.
 */
async function installKeepNamesShim(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.__name ??= (fn: unknown) => fn;
  });
}

/**
 * Navigates and extracts without waiting for the page to finish loading.
 *
 * `waitUntil: "commit"` returns as soon as the navigation commits, so
 * extraction starts against a shell that is still hydrating — which is the
 * whole point for US1. A default `page.goto` waits for `load` and would settle
 * the page before extraction ever ran, making every readiness assertion pass
 * for the wrong reason.
 */
export async function openAndExtract(
  page: Page,
  url: string,
  args: ExtractArgs = {}
): Promise<RawPageExtract> {
  await page.goto(url, { waitUntil: "commit" });
  return runExtractor(page, args);
}

/** Wall-clock duration of an extraction, for the SC-004 / QG-4 fast-path budget. */
export async function timeExtraction(
  page: Page,
  url: string,
  args: ExtractArgs = {}
): Promise<{ extract: RawPageExtract; elapsedMs: number }> {
  await page.goto(url, { waitUntil: "commit" });
  const startedAt = Date.now();
  const extract = await runExtractor(page, args);
  return { extract, elapsedMs: Date.now() - startedAt };
}
