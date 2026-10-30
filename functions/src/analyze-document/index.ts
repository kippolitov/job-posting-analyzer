import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  isPriorFingerprint,
  isScoringProfile,
  MAIN_TEXT_CAP,
  MIN_TEXT_CHARS,
  type AnalyzeJobRequest,
} from "../models/job";
import type { AuthenticatedUser } from "../models/user";
import type { ScoringProfile } from "../../../shared/types/profile";
import { pasteIdentity } from "../../../shared/pasteIdentity";
import { withAuth } from "../services/auth";
import {
  DocumentRejectedError,
  extractDocument,
  type DocumentRejectionCode,
} from "../services/documentExtraction";
import { corsHeaders, errorResponse, requestOrigin } from "../services/http";
import {
  orchestrateJobAnalysis,
  JobSchemaError,
} from "../services/jobExtractionOrchestrator";
import {
  chargeForAnalysis,
  refundAfterFailure,
  settleCharge,
} from "../services/analysisMetering";
import { fingerprintForRequest } from "../services/profileFingerprint";
import { sha256Hex } from "../services/savedJobsRepository";
import { withRateLimit } from "../services/rateLimiter";

const REJECTION_STATUS: Record<DocumentRejectionCode, number> = {
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  FILE_PASSWORD_PROTECTED: 422,
  FILE_UNREADABLE: 422,
  FILE_NO_TEXT: 422,
};

/** The posting a request carries: an uploaded file's text, or pasted text (FR-027). */
interface PostingSource {
  source: "document" | "paste";
  /** Title the model sees: the filename for a document, empty for a paste. */
  title: string;
  filename?: string;
  mainText: string;
  canonicalUrl: string;
}

/**
 * POST /api/analyze-document (contracts/analyze-document.md, 006
 * contracts/analyze-api.md): multipart → parse and validate every part →
 * extract a `file` part (research R7 of 004: reject before charging) or
 * length-check a `text` part → charge the counter research R6 picks →
 * synthetic AnalyzeJobRequest → orchestrateJobAnalysis → response with
 * saveKey.
 */
export async function analyzeDocumentHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") {
    return { status: 204, headers: corsHeaders(origin) };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "Request must be multipart/form-data.",
      origin
    );
  }

  const file = formData.get("file");
  const text = formData.get("text");
  const hasFile = file instanceof Blob;
  const hasText = typeof text === "string";
  if (hasFile === hasText) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      hasFile
        ? "Send either a file or text, not both."
        : "Missing required file part.",
      origin
    );
  }

  const profileField = formData.get("profile");
  const profile = typeof profileField === "string" ? profileField : undefined;
  const profileData = parseProfileData(formData.get("profileData"));
  if (profileData === "invalid") {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "profileData must be JSON with text: string and dealbreakers: string[].",
      origin
    );
  }
  const priorField = formData.get("priorFingerprint");
  const priorFingerprint =
    typeof priorField === "string" && priorField ? priorField : null;
  if (!isPriorFingerprint(priorFingerprint)) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "priorFingerprint must be 64 hex characters.",
      origin
    );
  }
  const intent =
    formData.get("rescore") === "true" ? { priorFingerprint } : undefined;
  const assumeJobPosting = formData.get("assumeJobPosting") === "true";

  // The both/neither check above guarantees `file` is a Blob without text.
  const posting = hasText
    ? await pastedPosting(text, origin)
    : await documentPosting(file as Blob, context, origin);
  if (!("mainText" in posting)) return posting;

  const syntheticRequest: AnalyzeJobRequest = {
    extract: {
      url: "",
      canonicalUrl: "",
      title: posting.title,
      jsonLd: [],
      mainText: posting.mainText,
      extractedAt: new Date().toISOString(),
    },
    profile,
    ...(profileData ? { profileData } : {}),
    assumeJobPosting,
  };
  const saveKey = sha256Hex(posting.canonicalUrl);

  // Only now — after every validation rejection has already returned —
  // does the request touch the caller's monthly allowance (research R7).
  const outcome = await chargeForAnalysis(
    {
      user,
      saveKey,
      intent,
      currentFingerprint: fingerprintForRequest(syntheticRequest),
    },
    context,
    origin
  );
  if (!outcome.ok) return outcome.response;
  const { charge } = outcome;

  try {
    const analysis = await orchestrateJobAnalysis(
      syntheticRequest,
      user.tier,
      (message) => context.warn(message),
      (usage) => context.log("model.usage", JSON.stringify(usage))
    );
    const settled = await settleCharge(
      { user, intent },
      charge,
      analysis,
      assumeJobPosting
    );
    return {
      status: 200,
      headers: corsHeaders(origin),
      jsonBody: {
        analysis,
        source: posting.source,
        ...(posting.filename !== undefined
          ? { filename: posting.filename }
          : {}),
        // The client cannot derive `doc:<hash>` itself (it never sees the
        // extracted text) — canonicalUrl must round-trip so PUT
        // /api/jobs/{saveKey} can pass saveJob's sha256Hex(canonicalUrl)
        // === key check (data-model.md §2).
        canonicalUrl: posting.canonicalUrl,
        saveKey,
        ...settled,
      },
    };
  } catch (err) {
    refundAfterFailure(user, charge, context);
    if (err instanceof JobSchemaError) {
      context.error("analyze-document schema failure:", err.message);
      return errorResponse(
        502,
        "SCHEMA_PARSE_FAILED",
        "The analysis service returned an unusable result. Please try again.",
        origin
      );
    }
    // Includes ModelConfigError: a misconfigured app setting is a 500, refunded
    // like any other system failure (contracts/model-config.md).
    context.error("orchestrateJobAnalysis failed:", err);
    return errorResponse(
      500,
      "SERVICE_ERROR",
      "Analysis failed. Please try again.",
      origin
    );
  }
}

/** Absent → undefined; present but malformed → "invalid" (never a silent fallback). */
function parseProfileData(
  field: ReturnType<FormData["get"]>
): ScoringProfile | undefined | "invalid" {
  if (field === null) return undefined;
  if (typeof field !== "string") return "invalid";
  try {
    const parsed: unknown = JSON.parse(field);
    return isScoringProfile(parsed) ? parsed : "invalid";
  } catch {
    return "invalid";
  }
}

/**
 * The web's Paste text option (FR-027): the same bounds and messages as the
 * extension's paste composer, checked before charging, and the same
 * `paste:` identity, so a paste lands on the same saved entry on both
 * surfaces (research R7).
 */
async function pastedPosting(
  text: string,
  origin: string | null
): Promise<PostingSource | HttpResponseInit> {
  if (text.length < MIN_TEXT_CHARS) {
    return errorResponse(
      400,
      "TEXT_TOO_SHORT",
      "Paste more of the posting before analyzing.",
      origin
    );
  }
  if (text.length > MAIN_TEXT_CAP) {
    return errorResponse(
      413,
      "TEXT_TOO_LONG",
      "Trim it to the posting itself before analyzing.",
      origin
    );
  }
  return {
    source: "paste",
    title: "",
    mainText: text,
    canonicalUrl: await pasteIdentity(text),
  };
}

async function documentPosting(
  file: Blob,
  context: InvocationContext,
  origin: string | null
): Promise<PostingSource | HttpResponseInit> {
  const filename =
    "name" in file && typeof file.name === "string" ? file.name : "document";
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const extracted = await extractDocument(bytes);
    return {
      source: "document",
      title: filename,
      filename,
      mainText: extracted.text.slice(0, MAIN_TEXT_CAP),
      canonicalUrl: `doc:${sha256Hex(extracted.text)}`,
    };
  } catch (err) {
    if (err instanceof DocumentRejectedError) {
      return errorResponse(
        REJECTION_STATUS[err.code],
        err.code,
        err.message,
        origin
      );
    }
    context.error("document extraction failed unexpectedly:", err);
    return errorResponse(
      422,
      "FILE_UNREADABLE",
      "This document could not be read. It may be corrupt.",
      origin
    );
  }
}

app.http("analyze-document", {
  methods: ["POST"],
  // withAuth (Google ID token) is the real gate; anonymous so the public
  // web SPA (whose bundle can never safely hold a function key) can call
  // this route too (contracts/web-auth.md).
  authLevel: "anonymous",
  route: "analyze-document",
  handler: withRateLimit("analyze", withAuth(analyzeDocumentHandler)),
});

app.http("analyze-document-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "analyze-document",
  handler: (request: HttpRequest) => ({
    status: 204,
    headers: corsHeaders(requestOrigin(request)),
  }),
});
