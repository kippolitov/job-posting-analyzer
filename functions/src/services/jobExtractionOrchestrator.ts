import { AzureOpenAI } from "openai";
import type {
  AnalyzeJobRequest,
  JobAnalysisPayload,
  JobAnalysisResponse,
} from "../models/job";
import { isJobAnalysisPayload } from "../models/job";

/** Model output violated the schema even after the repair retry → HTTP 502. */
export class JobSchemaError extends Error {}

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
      required: ["score", "rationale"],
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        rationale: { type: "string", maxLength: 400 },
      },
    },
  },
} as const;

function buildSystemPrompt(hasProfile: boolean, assumeJobPosting: boolean): string {
  const lines = [
    "You are a precise job-posting analyzer. Extract structured facts from the page content.",
    "Rules:",
    "- JSON-LD JobPosting values are trusted ground truth for title, company, location, and salary unless the body text contradicts them; when the body contradicts JSON-LD, follow the body.",
    "- NEVER invent a work arrangement or day counts. If the posting does not state or clearly imply the arrangement, answer arrangement=\"unspecified\" with arrangementConfidence=\"none\" and arrangementEvidence=null.",
    "- arrangementEvidence MUST be a verbatim substring of the provided content — copy it exactly, never paraphrase.",
    "- arrangementConfidence is \"explicit\" when the arrangement is stated outright, \"inferred\" when derived from indirect wording (inference still requires a verbatim evidence quote).",
    "- JSON-LD jobLocationType \"TELECOMMUTE\" means arrangement=\"remote\" with confidence \"explicit\".",
    "- daysInOffice/daysRemote: only for hybrid roles and only when stated or directly inferable, with the evidence quote covering them; otherwise null.",
    "- remoteRestrictions: geographic or timezone limits on remote work (e.g. \"US only\"), else null.",
    "- techStack: concrete technologies named in the posting, max 25 entries.",
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
      "- fit.score is 0-100 for how well the posting matches the profile; fit.rationale is one to two sentences.",
      "- If the posting violates any stated dealbreaker in the profile, cap fit.score at 20 or below and name the dealbreaker in the rationale."
    );
  } else {
    lines.push("No candidate profile was provided: set fit to null.");
  }
  return lines.join("\n");
}

function buildUserMessage(req: AnalyzeJobRequest): string {
  const parts: string[] = [];
  if (req.profile) {
    parts.push(`Candidate profile:\n${req.profile}`);
  }
  if (req.extract.jsonLd.length > 0) {
    parts.push(`JSON-LD JobPosting data:\n${JSON.stringify(req.extract.jsonLd)}`);
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
    `${JSON.stringify(req.extract.jsonLd)} ${req.extract.title} ${req.extract.mainText}`
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
  if (!req.profile) {
    result.fit = null;
  }
  return result;
}

export async function orchestrateJobAnalysis(
  req: AnalyzeJobRequest,
  warn: (message: string) => void = () => {}
): Promise<JobAnalysisResponse> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? "";
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? "";
  const deployment =
    process.env.AZURE_OPENAI_JOB_DEPLOYMENT ??
    process.env.AZURE_OPENAI_DEPLOYMENT ??
    "gpt-4o-mini";

  const client = new AzureOpenAI({ endpoint, apiKey, deployment, apiVersion: "2024-08-01-preview" });

  const messages = [
    {
      role: "system" as const,
      content: buildSystemPrompt(Boolean(req.profile), Boolean(req.assumeJobPosting)),
    },
    { role: "user" as const, content: buildUserMessage(req) },
  ];

  const complete = async (
    extraInstruction?: string
  ): Promise<JobAnalysisPayload | null> => {
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
      temperature: 0,
      max_tokens: 1500,
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

  let payload = await complete();
  if (!payload) {
    warn("job analysis output failed to parse; retrying with repair instruction");
    payload = await complete(
      "Your previous reply was not valid JSON for the required schema. Respond again with ONLY a valid JSON object matching the schema exactly."
    );
  }
  if (!payload) {
    throw new JobSchemaError("Model output did not match the job analysis schema.");
  }

  payload = validateEvidence(payload, req, warn);
  payload = enforceConsistency(payload, req);

  return {
    ...payload,
    model: deployment,
    analyzedAt: new Date().toISOString(),
  };
}
