import { expect, test } from "@playwright/test";
import { readLiveSelectionInPage } from "../../services/selectionService";

/**
 * "Analyze selection" reads the LIVE window.getSelection() (spec FR-023a,
 * FR-023b), never the context-menu payload's truncated selectionText. Real
 * Chromium: Selection/Range behavior is not something jsdom reproduces
 * faithfully (research R9's rationale applies here too).
 */

async function installKeepNamesShim(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.__name ??= (fn: unknown) => fn;
  });
}

test("reads the full live selection, longer than any context-menu truncation limit (FR-023b, SC-008b)", async ({
  page,
}) => {
  const longParagraph = "Senior engineer role. ".repeat(500); // ~11,500 chars
  await page.setContent(
    `<html><body><div id="posting"><p id="body">${longParagraph}</p></div></body></html>`
  );
  await installKeepNamesShim(page);

  await page.evaluate(() => {
    const el = document.getElementById("body")!;
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });

  const result = await page.evaluate(readLiveSelectionInPage);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.text.length).toBeGreaterThan(10_900);
    expect(result.text).toContain("Senior engineer role.");
  }
});

test("derives a selector from the selection's common ancestor (FR-023c)", async ({ page }) => {
  await page.setContent(
    '<html><body><div id="posting"><p>Some job posting text here.</p></div></body></html>'
  );
  await installKeepNamesShim(page);

  await page.evaluate(() => {
    const p = document.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });

  const result = await page.evaluate(readLiveSelectionInPage);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.selector).toContain("#posting");
  }
});

test("fails with an explanation when nothing is selected", async ({ page }) => {
  await page.setContent("<html><body><p>Nothing selected here.</p></body></html>");
  await installKeepNamesShim(page);

  const result = await page.evaluate(readLiveSelectionInPage);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toMatch(/no text is selected/i);
  }
});

test("fails with an explanation and a distinguishable reason for a selection inside a shadow root (spec Edge Cases)", async ({
  page,
}) => {
  await page.setContent("<html><body><div id='host'></div></body></html>");
  await installKeepNamesShim(page);

  await page.evaluate(() => {
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    const p = document.createElement("p");
    p.textContent = "Text inside a shadow root, unaddressable from the top document.";
    shadow.appendChild(p);

    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });

  const result = await page.evaluate(readLiveSelectionInPage);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toMatch(/can't be scoped/i);
  }
});
