import { AzureOpenAI } from "openai";
import type {
  AnalyzeJobRequest,
  JobAnalysisPayload,
  JobAnalysisResponse,
} from "../models/job";
import { isJobAnalysisPayload } from "../models/job";
import type { Tier } from "../models/user";
import { resolveModelConfig } from "./modelConfig";
import { fingerprintForRequest, resolveScoringProfile } from "./profileFingerprint";
import { dealbreakerLinesFromPrompt } from "../../../shared/types/profile";

/** Model output violated the schema even after the repair retry → HTTP 502. */
export class JobSchemaError extends Error {}

/** Token counts for one completion call — never content (contracts/model-config.md). */
export interface ModelUsage {
  deployment: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  latencyMs: number;
  attempt: 1 | 2;
  finishReason: string | null;
}

// Authoritative structured-output schema — specs/008-job-posting-analyzer/contracts/analyze-job.md
const JOB_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "isJobPosting",
    "title",
    "company",
    "location",
    "arrangement",
    "arrangementConfidence",
    "arrangementEvidence",
    "daysInOffice",
    "daysRemote",
    "remoteRestrictions",
    "salary",
    "seniority",
    "techStack",
    "fit",
  ],
  properties: {
    isJobPosting: { type: "boolean" },
    title: { type: ["string", "null"] },
    company: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    arrangement: { enum: ["remote", "hybrid", "onsite", "unspecified"] },
    arrangementConfidence: { enum: ["explicit", "inferred", "none"] },
    arrangementEvidence: {
      type: ["string", "null"],
      description:
        "Verbatim quote from the posting; required when arrangement != unspecified",
    },
    daysInOffice: { type: ["integer", "null"], minimum: 0, maximum: 7 },
    daysRemote: { type: ["integer", "null"], minimum: 0, maximum: 7 },
    remoteRestrictions: { type: ["string", "null"] },
    salary: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["min", "max", "currency", "period"],
      properties: {
        min: { type: ["number", "null"] },
        max: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
        period: { enum: ["year", "month", "day", "hour", null] },
      },
    },
    seniority: {
      enum: [
        "junior",
        "mid",
        "senior",
        "staff",
        "principal",
        "manager",
        "director",
        "executive",
        "unspecified",
      ],
    },
    techStack: { type: "array", items: { type: "string" }, maxItems: 25 },
    fit: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "score",
        "rationale",
        "matching",
        "missing",
        "desired",
        "strengths",
        "weaknesses",
      ],
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        rationale: { type: "string", maxLength: 600 },
        matching: { type: "array", items: { type: "string" }, maxItems: 10 },
        missing: { type: "array", items: { type: "string" }, maxItems: 10 },
        desired: { type: "array", items: { type: "string" }, maxItems: 10 },
        strengths: { type: "array", items: { type: "string" }, maxItems: 5 },
        weaknesses: { type: "array", items: { type: "string" }, maxItems: 5 },
      },
    },
  },
} as const;

function buildSystemPrompt(hasProfile: boolean, assumeJobPosting: boolean): string {
  const lines = [
    "You are a precise job-posting analyzer. Extract structured facts from the page content.",
    "Read the ENTIRE page content end to end — every section (overview, responsibilities, requirements, qualifications, nice-to-have, benefits) — before answering any field. Do not base an answer on only the first paragraph or the first section; a detail mentioned once, late in the posting, is as valid as one mentioned in the opening line.",
    "Rules:",
    "- JSON-LD and microdata JobPosting values are trusted ground truth for title, company, location, and salary unless the body text contradicts them; when the body contradicts structured data, follow the body. Where JSON-LD and microdata disagree with each other, prefer JSON-LD.",
    "- NEVER invent a work arrangement or day counts. If the posting does not state or clearly imply the arrangement, answer arrangement=\"unspecified\" with arrangementConfidence=\"none\" and arrangementEvidence=null.",
    "- arrangementEvidence MUST be a verbatim substring of the provided content — copy it exactly, never paraphrase.",
    "- arrangementConfidence is \"explicit\" when the arrangement is stated outright, \"inferred\" when derived from indirect wording (inference still requires a verbatim evidence quote).",
    "- JSON-LD jobLocationType \"TELECOMMUTE\" means arrangement=\"remote\" with confidence \"explicit\".",
    "- daysInOffice/daysRemote: only for hybrid roles and only when stated or directly inferable, with the evidence quote covering them; otherwise null.",
    "- remoteRestrictions: geographic or timezone limits on remote work (e.g. \"US only\"), else null.",
    "- techStack: named programming languages, frameworks, libraries, databases, cloud platforms, and developer tools/infrastructure ONLY — e.g. \"Python\", \"Kubernetes\", \"PostgreSQL\", \"AWS\", \"React\". EXCLUDE generic business/process terms, methodologies, and soft skills even if the posting calls them out prominently (e.g. \"on-call\", \"incident response\", \"vendor management\", \"unit economics\", \"QA\", \"Agile\", \"stakeholder management\") — these are not technologies. Scan the entire posting, including team/stack overviews and nice-to-have lines, not just the main requirements section — a technology named once late in the posting counts. Each entry appears exactly once (no duplicates, no near-duplicate variants of the same name). Max 25 entries, most prominent/required first. If the posting names no concrete technologies, return an empty array — do not pad it with process or domain terms.",
    "- isJobPosting: false when the content is not a job posting (news article, list page, etc.); still fill any fields you can.",
  ];
  if (assumeJobPosting) {
    lines.push(
      "- The user has confirmed this page should be treated as a job posting: set isJobPosting=true and extract on a best-effort basis."
    );
  }
  if (hasProfile) {
    lines.push(
      "Fit scoring (a candidate profile is provided):",
      "- fit.score is 0-100 and measures only how well the posting matches the candidate's skills, experience and seniority; dealbreakers are judged separately and never change the score. Score against this rubric: 85-100: all required skills covered and seniority aligned; 65-84: minor gaps; 40-64: significant gaps or a level mismatch; 0-39: major mismatch. fit.rationale is two to three sentences summarizing the match, drawing on the posting as a whole (not just its opening paragraph).",
      "- fit.matching: the required responsibilities and skills from the posting that the candidate's profile clearly covers (short phrases, most important first).",
      "- fit.missing: required responsibilities and skills from the posting that the profile shows no evidence of.",
      "- fit.desired: nice-to-have / preferred qualifications from the posting that the profile does not cover.",
      "- fit.strengths: what makes this specific role a strong choice for this candidate (e.g. seniority alignment, domain overlap, growth direction).",
      "- fit.weaknesses: risks or downsides of this role for this candidate (e.g. skill gaps to close, seniority mismatch, unstated arrangement, below-preference salary).",
      "- Base every item on the posting and profile text only; never invent skills or requirements.",
      "- a fact the posting does not state is not a violation; list it as \"Unverified: …\" in fit.weaknesses instead."
    );
  } else {
    lines.push("No candidate profile was provided: set fit to null.");
  }
  return lines.join("\n");
}

/**
 * The profile text the fit call sees: no dealbreaker section, so dealbreakers
 * cannot move the score (SC-002) and are judged by their own call (research R8
 * fallback). The fingerprint still covers the full profile.
 */
function profileWithoutDealbreakers(req: AnalyzeJobRequest): string | undefined {
  if (req.profileData) return req.profileData.text || undefined;
  const full = resolveScoringProfile(req);
  if (!full || dealbreakerLinesFromPrompt(full).length === 0) return full;
  const at = full.lastIndexOf("\n\nDealbreakers:\n");
  return at === -1 ? full : full.slice(0, at);
}

function dealbreakerLinesFor(req: AnalyzeJobRequest): string[] {
  return req.profileData?.dealbreakers ?? dealbreakerLinesFromPrompt(req.profile ?? "");
}

function buildUserMessage(req: AnalyzeJobRequest): string {
  const parts: string[] = [];
  const profile = profileWithoutDealbreakers(req);
  if (profile) {
    parts.push(`Candidate profile:\n${profile}`);
  }
  if (req.extract.jsonLd.length > 0) {
    parts.push(`JSON-LD JobPosting data:\n${JSON.stringify(req.extract.jsonLd)}`);
  }
  for (const source of req.extract.structuredSources ?? []) {
    parts.push(`Structured data (${source.kind}):\n${JSON.stringify(source.data)}`);
  }
  parts.push(`Page title: ${req.extract.title}`);
  parts.push(`Page content:\n${req.extract.mainText}`);
  return parts.join("\n\n");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Anti-hallucination backstop: evidence must be a substring of the model input. */
function validateEvidence(
  payload: JobAnalysisPayload,
  req: AnalyzeJobRequest,
  warn: (message: string) => void
): JobAnalysisPayload {
  if (payload.arrangement === "unspecified") return payload;

  const haystack = normalizeWhitespace(
    `${JSON.stringify(req.extract.jsonLd)} ${JSON.stringify(req.extract.structuredSources ?? [])} ${req.extract.title} ${req.extract.mainText}`
  );
  const evidence = payload.arrangementEvidence
    ? normalizeWhitespace(payload.arrangementEvidence)
    : "";

  if (evidence.length === 0 || !haystack.includes(evidence)) {
    warn(
      `arrangementEvidence is not a substring of the input; downgrading ${payload.arrangement} -> unspecified`
    );
    return {
      ...payload,
      arrangement: "unspecified",
      arrangementConfidence: "none",
      arrangementEvidence: null,
      daysInOffice: null,
      daysRemote: null,
    };
  }
  return payload;
}

function enforceConsistency(
  payload: JobAnalysisPayload,
  req: AnalyzeJobRequest
): JobAnalysisPayload {
  const result = { ...payload };
  if (result.arrangement !== "hybrid") {
    result.daysInOffice = null;
    result.daysRemote = null;
  }
  if (!resolveScoringProfile(req)) {
    result.fit = null;
  }
  return result;
}

const DEALBREAKER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["violations"],
  properties: {
    violations: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dealbreaker", "quote"],
        properties: {
          dealbreaker: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
  },
} as const;

const DEALBREAKER_PROMPT = [
  "You check a job posting against a candidate's dealbreakers. You do not score fit.",
  "Go through the numbered dealbreakers one at a time. A dealbreaker is violated ONLY when the posting states something that directly contradicts it (for example the dealbreaker says \"Remote only\" and the posting says the team is hybrid or on-site; or it sets a minimum salary and the posting states a range whose maximum is below it, in the same currency).",
  "Silence, vagueness, a different currency, or a requirement the posting merely does not mention is NOT a violation.",
  "For each violated dealbreaker return it copied exactly as written, and a VERBATIM substring of the posting that contradicts it. If you cannot quote such a passage, it is not violated. Return an empty list when none is violated.",
].join("\n");

function postingHaystack(req: AnalyzeJobRequest): string {
  return normalizeWhitespace(
    `${JSON.stringify(req.extract.jsonLd)} ${JSON.stringify(req.extract.structuredSources ?? [])} ${req.extract.title} ${req.extract.mainText}`
  ).toLowerCase();
}

function normalizeDealbreaker(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

/**
 * Maps each model-reported violation onto the user's own dealbreaker line
 * (research R8, FR-005): normalized equality first, then normalized
 * containment in either direction. An unmatched entry is kept with a
 * warning, since dropping it could hide a real violation. Never reads or
 * writes `score`.
 */
export function resolveDealbreakers(
  payload: JobAnalysisPayload,
  dealbreakerLines: string[],
  warn: (message: string) => void
): JobAnalysisPayload {
  if (!payload.fit) return payload;
  const lines = dealbreakerLines.map((line) => ({ line, key: normalizeDealbreaker(line) }));
  const resolved: string[] = [];
  for (const entry of payload.fit.dealbreakersViolated ?? []) {
    const key = normalizeDealbreaker(entry);
    if (key.length === 0) continue;
    const match =
      lines.find((l) => l.key === key) ??
      lines.find((l) => l.key.includes(key) || key.includes(l.key));
    if (!match) {
      warn(`dealbreakersViolated entry "${entry}" matches no profile dealbreaker; keeping it`);
    }
    const value = match ? match.line : entry;
    if (!resolved.includes(value)) resolved.push(value);
  }
  return { ...payload, fit: { ...payload.fit, dealbreakersViolated: resolved } };
}

export async function orchestrateJobAnalysis(
  req: AnalyzeJobRequest,
  tier: Tier = "free",
  warn: (message: string) => void = () => {},
  observe?: (usage: ModelUsage) => void
): Promise<JobAnalysisResponse> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? "";
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? "";
  // Throws ModelConfigError before any model call (research R1).
  const { deployment, apiVersion, temperature, reasoningEffort } = resolveModelConfig(
    tier,
    process.env
  );

  const client = new AzureOpenAI({ endpoint, apiKey, deployment, apiVersion });

  const messages = [
    {
      role: "system" as const,
      content: buildSystemPrompt(
        Boolean(resolveScoringProfile(req)),
        Boolean(req.assumeJobPosting)
      ),
    },
    { role: "user" as const, content: buildUserMessage(req) },
  ];

  const complete = async (
    attempt: 1 | 2,
    extraInstruction?: string
  ): Promise<JobAnalysisPayload | null> => {
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model: deployment,
      messages: extraInstruction
        ? [...messages, { role: "system" as const, content: extraInstruction }]
        : messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "job_analysis",
          strict: true,
          schema: JOB_ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      // Each setting is sent only when configured, so a model that rejects
      // one is a settings change, not a code change (FR-M04).
      ...(temperature !== undefined ? { temperature } : {}),
      ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
      // Sized for the full fit breakdown (matching/missing/desired lists) on
      // top of the extraction fields. max_completion_tokens (not max_tokens)
      // — required by the gpt-5.x deployment generation, and accepted by
      // gpt-4o-mini too.
      max_completion_tokens: 3000,
    });

    observe?.({
      deployment,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      cachedTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
      attempt,
      finishReason: completion.choices[0]?.finish_reason ?? null,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    return isJobAnalysisPayload(parsed) ? parsed : null;
  };

  // Dealbreakers get their own call, run alongside the fit call (research R8
  // fallback): the fit call never sees them, so they cannot move the score.
  const lines = resolveScoringProfile(req) ? dealbreakerLinesFor(req) : [];
  const judge = async (): Promise<string[]> => {
    if (lines.length === 0) return [];
    try {
      const startedAt = Date.now();
      const completion = await client.chat.completions.create({
        model: deployment,
        messages: [
          { role: "system" as const, content: DEALBREAKER_PROMPT },
          {
            role: "user" as const,
            content: `Dealbreakers:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\n${buildUserMessage({ ...req, profile: undefined, profileData: undefined })}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dealbreaker_check",
            strict: true,
            schema: DEALBREAKER_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        ...(temperature !== undefined ? { temperature } : {}),
        ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
        max_completion_tokens: 1000,
      });
      observe?.({
        deployment,
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        cachedTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
        attempt: 1,
        finishReason: completion.choices[0]?.finish_reason ?? null,
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "") as {
        violations?: { dealbreaker?: string; quote?: string }[];
      };
      const haystack = postingHaystack(req);
      const kept: string[] = [];
      for (const v of parsed.violations ?? []) {
        const quote = normalizeWhitespace(v.quote ?? "").toLowerCase();
        if (quote.length > 0 && haystack.includes(quote) && v.dealbreaker) {
          kept.push(v.dealbreaker);
        } else {
          warn(`dealbreaker "${v.dealbreaker}" has no verbatim posting quote; dropping it`);
        }
      }
      return kept;
    } catch (error) {
      warn(`dealbreaker check failed (${error instanceof Error ? error.message : "unknown"}); reporting none`);
      return [];
    }
  };
  const firstAttempt = complete(1);
  const judged = judge();

  let payload = await firstAttempt;
  if (!payload) {
    warn("job analysis output failed to parse; retrying with repair instruction");
    payload = await complete(
      2,
      "Your previous reply was not valid JSON for the required schema. Respond again with ONLY a valid JSON object matching the schema exactly."
    );
  }
  if (!payload) {
    throw new JobSchemaError("Model output did not match the job analysis schema.");
  }

  payload = validateEvidence(payload, req, warn);
  payload = enforceConsistency(payload, req);
  const violated = await judged;
  if (payload.fit) {
    payload = { ...payload, fit: { ...payload.fit, dealbreakersViolated: violated } };
  }
  payload = resolveDealbreakers(payload, lines, warn);
  const profileFingerprint = fingerprintForRequest(req);
  if (payload.fit && profileFingerprint) {
    payload = { ...payload, fit: { ...payload.fit, profileFingerprint } };
  }

  return {
    ...payload,
    model: deployment,
    analyzedAt: new Date().toISOString(),
    tier,
  };
}
