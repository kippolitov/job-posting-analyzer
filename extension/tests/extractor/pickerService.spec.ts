import { expect, test } from "@playwright/test";
import { pickerPageScript } from "../../services/pickerService";

/**
 * Regression: `pickerPageScript` is injected via `chrome.scripting.executeScript`
 * in production, which — like Playwright's `page.evaluate(fn)` — serializes
 * the function with `Function.prototype.toString()` and re-evaluates it in
 * an isolated context with NO closure over this module's outer scope. A
 * `const` declared outside the function (module scope) but referenced
 * inside it compiles and passes every unit test (jsdom calls the function
 * in-process, where normal JS scoping still applies) yet throws
 * `ReferenceError` the moment it is actually injected — silently swallowed
 * by `listCandidates()`'s catch into an empty list, i.e. "No regions were
 * found on this page" on every real page. Only a real-Chromium,
 * `page.evaluate`-based test crosses this boundary the way production does
 * (research R9's rationale, extended to this file).
 */

async function installKeepNamesShim(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.__name ??= (fn: unknown) => fn;
  });
}

test("pickerPageScript survives serialization: lists real candidates when evaluated via page.evaluate, not just called in-process", async ({
  page,
}) => {
  await page.setContent(
    `<!doctype html><html><body><main>${"Job posting content describing the role in detail. ".repeat(
      20
    )}</main></body></html>`
  );
  await installKeepNamesShim(page);

  const result = await page.evaluate(pickerPageScript, { type: "list" });
  expect(result.kind).toBe("candidates");
  if (result.kind !== "candidates") throw new Error("unreachable");
  expect(result.candidates.length).toBeGreaterThan(0);
});
