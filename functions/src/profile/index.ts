import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import type { AuthenticatedUser } from "../models/user";
import { isProfilePutBody } from "../models/user";
import { withAuth } from "../services/auth";
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  noContent,
  preflightResponse,
  requestOrigin,
} from "../services/http";
import {
  DocumentRejectedError,
  REJECTION_STATUS,
  extractDocument,
} from "../services/documentExtraction";
import { withRateLimit } from "../services/rateLimiter";
import {
  ProfileTooLongError,
  addConfirmedSkill,
  deleteProfile,
  getProfile,
  putProfile,
} from "../services/profileRepository";

/** GET/PUT/DELETE /api/profile ← getProfile()/setProfile()/clearProfile(). */
export async function profileHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") return preflightResponse(origin);

  try {
    switch (request.method) {
      case "GET": {
        const profile = await getProfile(user.sub);
        if (!profile) {
          return errorResponse(404, "PROFILE_NOT_FOUND", "No profile is stored.", origin);
        }
        return jsonResponse(200, profile, origin);
      }
      case "PUT": {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse(400, "INVALID_REQUEST", "Body must be valid JSON.", origin);
        }
        if (!isProfilePutBody(body)) {
          return errorResponse(
            400,
            "INVALID_REQUEST",
            "Expected { text: string, dealbreakers: string[] }.",
            origin
          );
        }
        return jsonResponse(200, await putProfile(user.sub, body), origin);
      }
      case "DELETE": {
        await deleteProfile(user.sub);
        return noContent(origin);
      }
      default:
        return errorResponse(405, "INVALID_REQUEST", "Method not allowed.", origin);
    }
  } catch (err) {
    if (err instanceof ProfileTooLongError) {
      return errorResponse(400, "PROFILE_TOO_LONG", err.message, origin);
    }
    context.error("profile endpoint failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Storage failed. Please try again.", origin);
  }
}

const CONFIRMED_SKILL_MAX = 100;

/** POST /api/profile/confirmed-skills (contracts/profile-api.md §4a). */
export async function confirmedSkillsHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") return preflightResponse(origin);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Body must be valid JSON.", origin);
  }
  const label =
    typeof body === "object" && body !== null && typeof (body as { label?: unknown }).label === "string"
      ? (body as { label: string }).label.trim()
      : "";
  if (label.length === 0 || label.length > CONFIRMED_SKILL_MAX) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      `Expected { label: string } of 1 to ${CONFIRMED_SKILL_MAX} characters.`,
      origin
    );
  }

  try {
    const profile = await addConfirmedSkill(user.sub, label);
    if (!profile) {
      return errorResponse(404, "PROFILE_NOT_FOUND", "No profile is stored.", origin);
    }
    return jsonResponse(200, profile, origin);
  } catch (err) {
    if (err instanceof ProfileTooLongError) {
      return errorResponse(400, "PROFILE_TOO_LONG", err.message, origin);
    }
    context.error("confirmed-skills endpoint failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Storage failed. Please try again.", origin);
  }
}

/**
 * POST /api/profile/import (contracts/profile-api.md §4): extracts a résumé's
 * text and returns it. No model call, no metering and no storage (research
 * R12): the bytes go out of scope when the handler returns, and the text is
 * never logged.
 */
export async function profileImportHandler(
  request: HttpRequest,
  context: InvocationContext,
  _user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") return preflightResponse(origin);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Request must be multipart/form-data.", origin);
  }
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return errorResponse(400, "INVALID_REQUEST", "Missing required file part.", origin);
  }

  try {
    const { text } = await extractDocument(Buffer.from(await file.arrayBuffer()));
    return jsonResponse(200, { text, charCount: text.length }, origin);
  } catch (err) {
    if (err instanceof DocumentRejectedError) {
      return errorResponse(REJECTION_STATUS[err.code], err.code, err.message, origin);
    }
    context.error("profile import extraction failed unexpectedly:", err);
    return errorResponse(
      422,
      "FILE_UNREADABLE",
      "This document could not be read. It may be corrupt.",
      origin
    );
  }
}

app.http("profile", {
  methods: ["GET", "PUT", "DELETE"],
  authLevel: "anonymous", // withAuth (Google ID token) is the real gate; anonymous so the public web SPA can call this route too
  route: "profile",
  handler: withAuth(profileHandler),
});

app.http("profile-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "profile",
  handler: (request: HttpRequest) => ({
    status: 204,
    headers: corsHeaders(requestOrigin(request)),
  }),
});

app.http("profile-import", {
  methods: ["POST"],
  authLevel: "anonymous", // withAuth is the real gate, as for /api/profile
  route: "profile/import",
  handler: withRateLimit("analyze", withAuth(profileImportHandler)),
});

app.http("profile-import-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "profile/import",
  handler: (request: HttpRequest) => ({
    status: 204,
    headers: corsHeaders(requestOrigin(request)),
  }),
});

app.http("profile-confirmed-skills", {
  methods: ["POST"],
  authLevel: "anonymous", // withAuth is the real gate, as for /api/profile
  route: "profile/confirmed-skills",
  handler: withAuth(confirmedSkillsHandler),
});

app.http("profile-confirmed-skills-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "profile/confirmed-skills",
  handler: (request: HttpRequest) => ({
    status: 204,
    headers: corsHeaders(requestOrigin(request)),
  }),
});
