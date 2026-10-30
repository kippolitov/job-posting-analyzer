import { AzureOpenAI } from "openai";
import type {
  AnalyzeJobRequest,
  EvidenceItem,
  Fit,
  FitEvidence,
  JobAnalysisPayload,
  JobAnalysisResponse,
} from "../models/job";
import { isJobAnalysisPayload } from "../models/job";
import type { Tier } from "../models/user";
import { resolveModelConfig } from "./modelConfig";
import { fingerprintForRequest, resolveScoringProfile } from "./profileFingerprint";
import {
  SPONSORSHIP_LINE,
  dealbreakerLinesFromPrompt,
  preferenceLines,
  profileToPromptText,
} from "../../../shared/types/profile";
import { applyPreferences } from "./applyPreferences";

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

// One fit-list entry as the model returns it: the label plus the quotes behind
// it (research R9). The wire shape keeps plain label arrays; see splitEvidence.
const EVIDENCE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["label", "postingQuote", "profileQuote"],
  properties: {
    label: { type: "string" },
    postingQuote: { type: ["string", "null"] },
    profileQuote: { type: ["string", "null"] },
  },
} as const;

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
        matching: { type: "array", items: EVIDENCE_ITEM_SCHEMA, maxItems: 8 },
        missing: { type: "array", items: EVIDENCE_ITEM_SCHEMA, maxItems: 8 },
        desired: { type: "array", items: EVIDENCE_ITEM_SCHEMA, maxItems: 10 },
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
      "- fit.matching: the required responsibilities and skills from the posting that the candidate's profile clearly covers (short phrases, most important first, at most 8).",
      "- fit.missing: required responsibilities and skills from the posting that the profile shows no evidence of (at most 8).",
      "- fit.desired: nice-to-have / preferred qualifications from the posting that the profile does not cover.",
      "- fit.strengths: what makes this specific role a strong choice for this candidate (e.g. seniority alignment, domain overlap, growth direction).",
      "- fit.weaknesses: risks or downsides of this role for this candidate (e.g. skill gaps to close, seniority mismatch, unstated arrangement, below-preference salary).",
      "- Every item in fit.matching, fit.missing and fit.desired has a label, a postingQuote and a profileQuote. postingQuote is the shortest verbatim span of the posting that states the requirement; profileQuote is the shortest verbatim span of the candidate profile that covers it. Copy both exactly, never paraphrase. profileQuote is null for fit.missing and fit.desired items, and either quote is null when no span supports the item.",
      "- A \"Confirmed skills:\" section in the profile lists skills the candidate states they have. Treat each line there as evidence: a requirement it covers goes in fit.matching, never fit.missing or fit.desired, with that line as its profileQuote, and the score reflects it.",
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
  if (req.profileData) {
    // Dealbreakers and preferences are judged elsewhere; confirmed skills are
    // evidence about the candidate, so they stay with the résumé text.
    const { text, confirmedSkills } = req.profileData;
    if (!text) return undefined;
    return profileToPromptText({ text, dealbreakers: [], confirmedSkills });
  }
  const full = resolveScoringProfile(req);
  if (!full || dealbreakerLinesFromPrompt(full).length === 0) return full;
  const at = full.lastIndexOf("\n\nDealbreakers:\n");
  return at === -1 ? full : full.slice(0, at);
}

/**
 * What the judge checks: the dealbreakers plus the preferences only the model
 * can read (locations, sponsorship; research R11). They are numbered like any
 * dealbreaker, so a violation maps back to the profile's own line.
 */
function dealbreakerLinesFor(req: AnalyzeJobRequest): string[] {
  const dealbreakers =
    req.profileData?.dealbreakers ?? dealbreakerLinesFromPrompt(req.profile ?? "");
  const preferences = req.profileData?.preferences;
  const judged = preferenceLines(preferences).filter(
    (line) => line.startsWith("Locations or timezones:") || line === SPONSORSHIP_LINE
  );
  return [...dealbreakers, ...judged];
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

/**
 * The fit call's messages. The eval compares them with and without the
 * profile's dealbreakers to show the score cannot depend on them (SC-002).
 */
export function fitCallMessages(req: AnalyzeJobRequest): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(Boolean(resolveScoringProfile(req)), Boolean(req.assumeJobPosting)),
    },
    { role: "user", content: buildUserMessage(req) },
  ];
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One fit-list entry as the model returns it (research R9). */
interface ModelFitItem {
  label: string;
  postingQuote: string | null;
  profileQuote: string | null;
}

/** The model-facing shape: only `fit`'s three lists differ from the wire `JobAnalysisPayload`. */
type ModelFit = Omit<Fit, "matching" | "missing" | "desired" | "evidence"> & {
  matching?: (ModelFitItem | string)[];
  missing?: (ModelFitItem | string)[];
  desired?: (ModelFitItem | string)[];
};
type ModelJobAnalysisPayload = Omit<JobAnalysisPayload, "fit"> & { fit: ModelFit | null };

const QUOTE_CAP = 200;

/**
 * Anti-hallucination backstop for evidence quotes (research R9): a quote that
 * is not a whitespace-normalized substring of its haystack becomes `null`, with
 * one warning per drop. A valid quote is capped at 200 characters afterwards,
 * because strict mode does not reliably enforce `maxLength`.
 */
function validateQuote(
  quote: string | null | undefined,
  haystack: string,
  what: string,
  warn: (message: string) => void
): string | null {
  const normalized = normalizeWhitespace(quote ?? "");
  if (normalized.length === 0) return null;
  if (!haystack.includes(normalized)) {
    warn(`${what} quote is not a substring of the input; dropping it`);
    return null;
  }
  return normalized.slice(0, QUOTE_CAP);
}

/**
 * Turns the model's `{label, postingQuote, profileQuote}` lists into the wire
 * shape: plain label arrays (old clients render these forever, research R4)
 * plus `fit.evidence` with validated quotes. An item with a blank label is
 * dropped from both. `profileQuote` is always null for `missing` and `desired`.
 */
function splitEvidence(
  modelFit: ModelFit,
  postingText: string,
  profileText: string,
  warn: (message: string) => void
): Fit {
  const evidence: FitEvidence = {};
  const labels: Record<"matching" | "missing" | "desired", string[]> = {
    matching: [],
    missing: [],
    desired: [],
  };
  for (const list of ["matching", "missing", "desired"] as const) {
    const items: EvidenceItem[] = [];
    for (const raw of modelFit[list] ?? []) {
      const item: ModelFitItem =
        typeof raw === "string" ? { label: raw, postingQuote: null, profileQuote: null } : raw;
      const label = normalizeWhitespace(item.label ?? "");
      if (label.length === 0) continue;
      const postingQuote = validateQuote(item.postingQuote, postingText, `${list} "${label}" posting`, warn);
      let profileQuote: string | null = null;
      if (list === "matching") {
        profileQuote = validateQuote(item.profileQuote, profileText, `${list} "${label}" profile`, warn);
      } else if (normalizeWhitespace(item.profileQuote ?? "").length > 0) {
        warn(`${list} "${label}" profile quote is not allowed on this list; dropping it`);
      }
      labels[list].push(label);
      items.push({ label, postingQuote, profileQuote });
    }
    evidence[list] = items;
  }
  const { matching: _m, missing: _x, desired: _d, ...rest } = modelFit;
  return { ...rest, ...labels, evidence };
}

function toWirePayload(
  payload: ModelJobAnalysisPayload,
  req: AnalyzeJobRequest,
  warn: (message: string) => void
): JobAnalysisPayload {
  if (!payload.fit) return { ...payload, fit: null };
  const postingText = normalizeWhitespace(
    `${JSON.stringify(req.extract.jsonLd)} ${JSON.stringify(req.extract.structuredSources ?? [])} ${req.extract.title} ${req.extract.mainText}`
  );
  const profileText = normalizeWhitespace(profileWithoutDealbreakers(req) ?? "");
  return { ...payload, fit: splitEvidence(payload.fit, postingText, profileText, warn) };
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
  required: ["checks"],
  properties: {
    checks: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        // Quote before verdict, so the verdict is grounded in what was quoted.
        required: ["number", "postingSays", "verdict"],
        properties: {
          number: { type: "integer" },
          postingSays: { type: "string" },
          verdict: { enum: ["violated", "compatible", "not stated"] },
        },
      },
    },
  },
} as const;

const DEALBREAKER_PROMPT = [
  "Check a job posting against the candidate's numbered dealbreakers. Do not score fit.",
  "Return one check per dealbreaker, in order: postingSays is the shortest VERBATIM substring of the posting that decides it (\"\" if none), then the verdict: violated (the posting states a fact contradicting it), compatible (it states a fact satisfying it), or not stated (silent, vague, or a guess). Silence is never a violation.",
  "- Arrangement (\"Remote only\", \"No fully on-site roles\"): decided only by how the role or the company works (remote, hybrid, office days, on-site), including a company-wide work policy anywhere on the page. A conditional line (\"if the posting is specified as Onsite…\"), a home area, relocation, job location, travel or occasional meetups do not decide it. Mind negations: only a fully on-site role violates \"No fully on-site roles\"; hybrid or remote is compatible.",
  "- Minimum salary: compare only pay in the same currency and period, violated only if every stated range tops out below it; otherwise not stated.",
  "- Location or time zone (\"EU timezones only\"): violated if the role's own location or allowed candidate region is outside it (a US city, \"US only\"); compatible if inside it (UK, London, CET ±2h are European) or that region may apply (\"US and Europe\"). Site menus, search filters and office lists do not count.",
  "- Work authorization (\"needs visa sponsorship\"): violated only if the posting states it cannot or will not sponsor visas, or requires existing work authorization or residency (\"US citizens only\", \"must be authorized to work without sponsorship\"); compatible if it offers sponsorship or relocation support; otherwise not stated.",
  "- The job description text wins over JSON-LD and page headers.",
].join("\n");

function postingHaystack(req: AnalyzeJobRequest): string {
  return normalizeWhitespace(
    `${JSON.stringify(req.extract.jsonLd)} ${JSON.stringify(req.extract.structuredSources ?? [])} ${req.extract.title} ${req.extract.mainText}`
  ).toLowerCase();
}

/**
 * The profile lines the judge's checks report as violated (research R8,
 * FR-005). A check names its dealbreaker by number, so the reported line is
 * the user's exact wording. A violation counts only with a verbatim posting
 * quote. Never reads or writes `score`.
 */
export function violatedLines(
  checks: { number?: number; postingSays?: string; verdict?: string }[],
  lines: string[],
  haystack: string,
  warn: (message: string) => void
): string[] {
  const violated: string[] = [];
  for (const check of checks) {
    if (check.verdict !== "violated") continue;
    const line = Number.isInteger(check.number) ? lines[check.number! - 1] : undefined;
    if (line === undefined) {
      warn(`dealbreaker ${check.number} is not in the profile; dropping it`);
      continue;
    }
    const quote = normalizeWhitespace(check.postingSays ?? "").toLowerCase();
    if (quote.length === 0 || !haystack.includes(quote)) {
      warn(`dealbreaker "${line}" has no verbatim posting quote; dropping it`);
      continue;
    }
    if (!violated.includes(line)) violated.push(line);
  }
  return violated;
}

/**
 * Extensions from before PR2 send no `profileData` and ignore
 * `dealbreakersViolated`, so the violation is named in the rationale they do
 * render. The score is untouched (FR-005). Clients that send `profileData`
 * show the banner instead.
 */
function withLegacyDealbreakerNote(rationale: string, violated: string[]): string {
  if (violated.length === 0) return rationale;
  const noun = violated.length === 1 ? "dealbreaker" : "dealbreakers";
  return `${rationale} Violates your ${noun}: ${violated.join("; ")}.`;
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

  const messages = fitCallMessages(req);

  const complete = async (
    attempt: 1 | 2,
    extraInstruction?: string
  ): Promise<ModelJobAnalysisPayload | null> => {
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
      // Sized for the full fit breakdown (matching/missing/desired lists with
      // their evidence quotes) on top of the extraction fields. max_completion_tokens (not max_tokens)
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
    return isJobAnalysisPayload(parsed) ? (parsed as unknown as ModelJobAnalysisPayload) : null;
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
            content: `${buildUserMessage({ ...req, profile: undefined, profileData: undefined })}\n\nDealbreakers:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
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
        checks?: { number?: number; postingSays?: string; verdict?: string }[];
      };
      return violatedLines(parsed.checks ?? [], lines, postingHaystack(req), warn);
    } catch (error) {
      warn(`dealbreaker check failed (${error instanceof Error ? error.message : "unknown"}); reporting none`);
      return [];
    }
  };
  const firstAttempt = complete(1);
  const judged = judge();

  let modelPayload = await firstAttempt;
  if (!modelPayload) {
    warn("job analysis output failed to parse; retrying with repair instruction");
    modelPayload = await complete(
      2,
      "Your previous reply was not valid JSON for the required schema. Respond again with ONLY a valid JSON object matching the schema exactly."
    );
  }
  if (!modelPayload) {
    throw new JobSchemaError("Model output did not match the job analysis schema.");
  }

  let payload = toWirePayload(modelPayload, req, warn);
  payload = validateEvidence(payload, req, warn);
  payload = enforceConsistency(payload, req);
  const violated = await judged;
  if (payload.fit) {
    payload = {
      ...payload,
      fit: {
        ...payload.fit,
        rationale: req.profileData
          ? payload.fit.rationale
          : withLegacyDealbreakerNote(payload.fit.rationale, violated),
        dealbreakersViolated: violated,
      },
    };
  }
  payload = applyPreferences(payload, req.profileData?.preferences);
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
