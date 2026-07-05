import { defineConfig } from "wxt";
import { config as loadDotenv } from "dotenv";

// Load .env.local with override:true so file values always win over any
// stale shell exports (dotenv's default is no-override, which causes the
// Vite define to receive "" when the var is exported-but-empty in the shell).
loadDotenv({ path: ".env.local", override: true });
loadDotenv({ path: ".env", override: false });

export default defineConfig({
  extensionApi: "chrome",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Job Posting Analyzer",
    description:
      "Analyzes job postings for work arrangement, salary, seniority, tech stack, and fit",
    permissions: ["sidePanel", "storage", "scripting", "activeTab"],
    // Localhost: lets the Playwright e2e suite exercise page extraction
    // (it cannot perform the action click that grants activeTab).
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
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
    },
  }),
});
