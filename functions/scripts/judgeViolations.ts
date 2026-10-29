/**
 * LLM judge for the PR1 fit eval (specs/006-profile-match-ux eval-models.md).
 *
 * The PR1 prompt reports a dealbreaker violation only in prose, and the score
 * proxy (score ≤ 20 + a mention) cannot tell a cap from a low skills match
 * whose rationale calls the dealbreaker satisfied. This reads each saved
 * rationale with a cheap model and records which of the profile's dealbreaker
 * lines it claims the posting violates, as `judgedViolations` on the result.
 * evalPostings --report then grades with detectionMethod "judge".
 *
 * It judges what the rationale CLAIMS, not whether the claim is true; pairs.json
 * decides truth. Each "violated" verdict must quote the rationale verbatim, and
 * a quote that is not a substring of the rationale is discarded, the same
 * backstop the orchestrator applies to arrangement evidence. Rewrites each file in place after every configuration, and
 * skips results already judged, so an interrupted run resumes.
 *
 * Usage: npx tsx scripts/judgeViolations.ts <eval-out.json>... [--deployment=gpt-5.4-mini] [--concurrency=4]
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { AzureOpenAI } from "openai";
import { DEFAULT_API_VERSION } from "../src/services/modelConfig";

interface SavedResult {
  profile: string;
  stripped: boolean;
  fit?: { rationale: string } | null;
  error?: string;
  judgedViolations?: string[];
}

interface SavedRun {
  results: Record<string, SavedResult[]>;
}

const MAX_429_RETRIES = 5;

const SYSTEM_PROMPT = [
  "You grade a job-fit rationale written by another model for one job posting and one candidate.",
  "For EACH of the candidate's dealbreakers, give one assessment:",
  "- \"violated\": the rationale says this posting violates or conflicts with that dealbreaker, including hedged claims (\"appears to be on-site, which conflicts with the remote-only dealbreaker\").",
  "- \"not-violated\": the rationale says it is satisfied, compatible, met, not stated, unverified or unknown.",
  "- \"not-discussed\": the rationale does not discuss it.",
  "quote: the exact words from the rationale that support a \"violated\" or \"not-violated\" verdict, copied verbatim; empty string for \"not-discussed\".",
  "Judge only what the rationale claims, never whether the claim is true. A skills mismatch is not a dealbreaker.",
].join("\n");

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

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

function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function dealbreakersByProfile(): Map<string, string[]> {
  const dir = path.join(__dirname, "..", "tests", "fixtures", "profiles");
  return new Map(
    readdirSync(dir)
      .filter((file) => file.endsWith(".json") && file !== "pairs.json")
      .map((file) => JSON.parse(readFileSync(path.join(dir, file), "utf-8")) as { id: string; dealbreakers: string[] })
      .map((profile) => [profile.id, profile.dealbreakers])
  );
}

async function judge(
  client: AzureOpenAI,
  deployment: string,
  dealbreakers: string[],
  rationale: string
): Promise<string[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: deployment,
        temperature: 0,
        max_completion_tokens: 600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Dealbreakers:\n${dealbreakers.map((d) => `- ${d}`).join("\n")}\n\nRationale:\n${rationale}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dealbreaker_assessments",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["assessments"],
              properties: {
                assessments: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["dealbreaker", "verdict", "quote"],
                    properties: {
                      // The enum forces the judge to copy each line exactly.
                      dealbreaker: { enum: dealbreakers },
                      verdict: { enum: ["violated", "not-violated", "not-discussed"] },
                      quote: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
        assessments?: { dealbreaker: string; verdict: string; quote: string }[];
      };
      const haystack = normalize(rationale);
      const violated = (parsed.assessments ?? []).filter(
        (a) =>
          a.verdict === "violated" &&
          a.quote.trim() !== "" &&
          haystack.includes(normalize(a.quote))
      );
      return [...new Set(violated.map((a) => a.dealbreaker))];
    } catch (err) {
      const status = (err as { status?: unknown }).status;
      if (status === 429 && attempt < MAX_429_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
}

async function main(): Promise<void> {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (files.length === 0) throw new Error("Usage: judgeViolations.ts <eval-out.json>...");
  const deployment = flag("deployment") ?? "gpt-5.4-mini";
  const concurrency = Number(flag("concurrency") ?? 4);
  const lines = dealbreakersByProfile();
  const client = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? "",
    apiKey: process.env.AZURE_OPENAI_API_KEY ?? "",
    deployment,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION,
  });

  for (const file of files) {
    const run = JSON.parse(readFileSync(file, "utf-8")) as SavedRun;
    for (const [label, results] of Object.entries(run.results)) {
      const todo = results.filter((r) => {
        if (r.stripped || r.error !== undefined || r.judgedViolations) return false;
        if ((lines.get(r.profile) ?? []).length === 0 || !r.fit) {
          r.judgedViolations = [];
          return false;
        }
        return true;
      });
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < todo.length) {
          const result = todo[next++];
          result.judgedViolations = await judge(
            client,
            deployment,
            lines.get(result.profile)!,
            result.fit!.rationale
          );
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
      writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
      console.warn(`${path.basename(file)} ${label}: judged ${todo.length}`);
    }
  }
}

main().catch((err) => {
  console.error("judge failed:", err);
  process.exitCode = 1;
});
