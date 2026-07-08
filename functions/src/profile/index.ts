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
} from "../services/http";
import {
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
  if (request.method === "OPTIONS") return preflightResponse();

  try {
    switch (request.method) {
      case "GET": {
        const profile = await getProfile(user.sub);
        if (!profile) {
          return errorResponse(404, "PROFILE_NOT_FOUND", "No profile is stored.");
        }
        return jsonResponse(200, profile);
      }
      case "PUT": {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse(400, "INVALID_REQUEST", "Body must be valid JSON.");
        }
        if (!isProfilePutBody(body)) {
          return errorResponse(
            400,
            "INVALID_REQUEST",
            "Expected { text: string, dealbreakers: string[] }."
          );
        }
        return jsonResponse(200, await putProfile(user.sub, body));
      }
      case "DELETE": {
        await deleteProfile(user.sub);
        return noContent();
      }
      default:
        return errorResponse(405, "INVALID_REQUEST", "Method not allowed.");
    }
  } catch (err) {
    context.error("profile endpoint failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Storage failed. Please try again.");
  }
}

app.http("profile", {
  methods: ["GET", "PUT", "DELETE"],
  authLevel: "function",
  route: "profile",
  handler: withAuth(profileHandler),
});

app.http("profile-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "profile",
  handler: () => ({ status: 204, headers: corsHeaders() }),
});
