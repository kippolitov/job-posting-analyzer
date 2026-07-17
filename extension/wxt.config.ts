import { defineConfig } from "wxt";
import { config as loadDotenv } from "dotenv";

// Load .env.local with override:true so file values always win over any
// stale shell exports (dotenv's default is no-override, which causes the
// Vite define to receive "" when the var is exported-but-empty in the shell).
loadDotenv({ path: ".env.local", override: true });
loadDotenv({ path: ".env", override: false });

export default defineConfig({
  extensionApi: "chrome",
  // No leading dot: Finder hides dot-directories by default, and this is
  // the folder you actually browse to grab built zips.
  outDir: "output",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Job Posting Analyzer",
    // Doubles as the Chrome Web Store listing summary (132-char limit there);
    // states free vs. paid plainly per CWS Deceptive Installation Tactics policy.
    description:
      "AI job posting analyzer: arrangement, salary, fit score. Free: 50 analyses/mo. Premium ($5/mo): 300/mo + better model.",
    permissions: ["sidePanel", "storage", "scripting", "activeTab", "identity"],
    // Localhost host permissions let the Playwright e2e suite exercise page
    // extraction (it cannot perform the action click that grants activeTab).
    // They are e2e-only (`npm run build:e2e`): store/release builds must not
    // request any host permissions, or Web Store review deepens.
    ...(process.env.E2E === "1"
      ? { host_permissions: ["http://localhost/*", "http://127.0.0.1/*"] }
      : {}),
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {},
  },
  vite: () => ({
    define: {
      WXT_AZURE_FUNCTION_URL: JSON.stringify(
        process.env.WXT_AZURE_FUNCTION_URL ?? ""
      ),
      WXT_AZURE_FUNCTION_KEY: JSON.stringify(
        process.env.WXT_AZURE_FUNCTION_KEY ?? ""
      ),
      WXT_API_BASE_URL: JSON.stringify(process.env.WXT_API_BASE_URL ?? ""),
      WXT_GOOGLE_OAUTH_CLIENT_ID: JSON.stringify(
        process.env.WXT_GOOGLE_OAUTH_CLIENT_ID ?? ""
      ),
    },
  }),
});
