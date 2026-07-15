/**
 * Accuracy eval for the job analyzer (SC-001 / SC-002 / SC-008).
 * Usage: npm run eval:postings [-- --tier=premium]
 *   (requires AZURE_OPENAI_* config; makes live model calls)
 *
 * Reads posting fixtures from tests/fixtures/postings/manifest.json and reports:
 * - arrangement accuracy (target >= 90% on a 50-posting set)
 * - stated-arrangement contradictions (target: zero)
 * - hybrid day-count extraction wherever the manifest expects one
 * - p95 latency (target <= 30s, Constitution IV/QG-4 — same ceiling for both tiers)
 *
 * --tier=free (default) uses AZURE_OPENAI_JOB_DEPLOYMENT; --tier=premium uses
 * AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM (data-model.md). Run once per tier and
 * compare the two reports for SC-008 sign-off (specs/003-freemium-premium-tier/eval-premium.md).
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { orchestrateJobAnalysis } from "../src/services/jobExtractionOrchestrator";
import type { Tier } from "../src/models/user";

interface ManifestEntry {
  file: string;
  /** Human-labeled ground truth. */
  expected: {
    arrangement: "remote" | "hybrid" | "onsite" | "unspecified";
    daysInOffice: number | null;
    /** True when the posting states the arrangement outright. */
    stated: boolean;
  };
}

const fixturesDir = path.join(__dirname, "..", "tests", "fixtures", "postings");

// Load env from local.settings.json, same as devServer.ts / func CLI.
try {
  const settings = JSON.parse(
    readFileSync(path.join(__dirname, "..", "local.settings.json"), "utf-8")
  ) as { Values?: Record<string, string> };
  for (const [key, value] of Object.entries(settings.Values ?? {})) {
    process.env[key] = process.env[key] ?? value;
  }
} catch {
  // Fall back to ambient environment variables.
}

function parseTier(argv: string[]): Tier {
  const flag = argv.find((arg) => arg.startsWith("--tier="));
  const value = flag?.slice("--tier=".length);
  if (value === "premium") return "premium";
  if (value && value !== "free") {
    throw new Error(`--tier must be "free" or "premium", got "${value}"`);
  }
  return "free";
}

function p95(sortedAscending: number[]): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.ceil(sortedAscending.length * 0.95) - 1
  );
  return sortedAscending[index];
}

async function main(): Promise<void> {
  const tier = parseTier(process.argv.slice(2));
  const manifest = JSON.parse(
    readFileSync(path.join(fixturesDir, "manifest.json"), "utf-8")
  ) as ManifestEntry[];

  const available = new Set(readdirSync(fixturesDir));
  let correctArrangement = 0;
  let contradictions = 0;
  let hybridExpected = 0;
  let hybridDaysCorrect = 0;
  const failures: string[] = [];
  const latenciesMs: number[] = [];
  let deploymentName = "";

  for (const entry of manifest) {
    if (!available.has(entry.file)) {
      console.warn(`skipping ${entry.file}: fixture file missing`);
      continue;
    }
    const mainText = readFileSync(path.join(fixturesDir, entry.file), "utf-8");
    const startedAt = Date.now();
    const result = await orchestrateJobAnalysis(
      {
        extract: {
          url: `https://eval.example/postings/${entry.file}`,
          canonicalUrl: `https://eval.example/postings/${entry.file}`,
          title: entry.file,
          jsonLd: [],
          mainText,
          extractedAt: new Date().toISOString(),
        },
      },
      tier
    );
    latenciesMs.push(Date.now() - startedAt);
    deploymentName = result.model;

    const arrangementOk = result.arrangement === entry.expected.arrangement;
    if (arrangementOk) {
      correctArrangement++;
    } else {
      failures.push(
        `${entry.file}: expected ${entry.expected.arrangement}, got ${result.arrangement}` +
          (result.arrangementEvidence ? ` (evidence: "${result.arrangementEvidence}")` : "")
      );
      // A contradiction is being wrong about an arrangement the posting states outright.
      if (entry.expected.stated) contradictions++;
    }

    if (entry.expected.arrangement === "hybrid" && entry.expected.daysInOffice !== null) {
      hybridExpected++;
      if (result.daysInOffice === entry.expected.daysInOffice) hybridDaysCorrect++;
      else
        failures.push(
          `${entry.file}: expected ${entry.expected.daysInOffice} days in office, got ${result.daysInOffice}`
        );
    }
  }

  const total = manifest.length;
  const accuracy = total > 0 ? (correctArrangement / total) * 100 : 0;
  const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
  const p95Ms = p95(sortedLatencies);

  console.log(`\n=== Job analyzer eval (SC-001 / SC-002 / SC-008) — tier: ${tier} ===`);
  console.log(`Deployment:                    ${deploymentName || "(none evaluated)"}`);
  console.log(`Postings evaluated:            ${total}`);
  console.log(`Arrangement accuracy:          ${accuracy.toFixed(1)}% (target ≥ 90%)`);
  console.log(`Stated-arrangement conflicts:  ${contradictions} (target 0)`);
  console.log(
    `Hybrid day counts:             ${hybridDaysCorrect}/${hybridExpected} extracted correctly`
  );
  console.log(
    `Latency p95:                   ${(p95Ms / 1000).toFixed(1)}s (target ≤ 30s, Constitution IV/QG-4)`
  );
  if (failures.length > 0) {
    console.log("\nMisses:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  if (total < 50) {
    console.warn(
      `\nWARNING: validation set has ${total} postings; SC-001 requires 50 before release sign-off.`
    );
  }

  const pass =
    accuracy >= 90 &&
    contradictions === 0 &&
    hybridDaysCorrect === hybridExpected &&
    p95Ms <= 30_000;
  if (total >= 50 && !pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exitCode = 1;
});
