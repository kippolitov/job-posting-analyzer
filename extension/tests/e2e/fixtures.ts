import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(dirname, "../../output/chrome-mv3");

export const e2eEnabled = process.env.E2E === "1";

export const skipReason =
  "E2e tests are opt-in: build the extension against a live backend " +
  "(set WXT_AZURE_FUNCTION_URL in .env.local, then `npm run build`) and run " +
  "with E2E=1, e.g. PowerShell: $env:E2E='1'; npm run test:e2e";

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  sidePanel: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use, testInfo) => {
    if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
      throw new Error(
        `Built extension not found at ${extensionPath}. Run \`npm run build\` first ` +
          "(with WXT_AZURE_FUNCTION_URL set, since the backend URL is baked in at build time)."
      );
    }
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "job-posting-analyzer-e2e-")
    );
    const context = await chromium.launchPersistentContext(userDataDir, {
      // The "chromium" channel supports extensions in the new headless mode;
      // branded Chrome 137+ no longer honors --load-extension.
      channel: "chromium",
      headless: process.env.E2E_HEADLESS === "1",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    // The config-level `trace` option only applies to the built-in context
    // fixture, so capture manually for this custom-launched context.
    await context.tracing.start({ screenshots: true, snapshots: true });
    await use(context);
    if (testInfo.status !== testInfo.expectedStatus) {
      await context.tracing.stop({ path: testInfo.outputPath("trace.zip") });
    } else {
      await context.tracing.stop();
    }
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent("serviceworker");
    }
    await use(new URL(worker.url()).host);
  },

  // The extension UI is a Chrome side panel. Playwright cannot open the real
  // side panel UI, but sidepanel.html is an ordinary extension page that
  // receives the same chrome.runtime broadcasts, so we load it in a tab.
  sidePanel: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await use(page);
  },
});

export { expect } from "@playwright/test";
