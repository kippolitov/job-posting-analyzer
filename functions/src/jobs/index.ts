import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import type { Arrangement, AuthenticatedUser, JobStatus } from "../models/user";
import {
  ARRANGEMENTS,
  JOB_STATUSES,
  isSavedJobPatchBody,
  isSavedJobPutBody,
} from "../models/user";
import { withAuth } from "../services/auth";
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  noContent,
  preflightResponse,
} from "../services/http";
import {
  ImmutableFieldError,
  KeyMismatchError,
  LibraryCapError,
  deleteJob,
  exportJobs,
  getJob,
  listJobs,
  patchJob,
  pruneArchived,
  saveJob,
} from "../services/savedJobsRepository";

/** GET /api/jobs?arrangement=&status= ← list(filter). */
export async function jobsCollectionHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  if (request.method === "OPTIONS") return preflightResponse();
  try {
    const arrangement = request.query.get("arrangement") ?? undefined;
    const status = request.query.get("status") ?? undefined;
    if (arrangement && !ARRANGEMENTS.includes(arrangement as Arrangement)) {
      return errorResponse(400, "INVALID_REQUEST", "Unknown arrangement filter.");
    }
    if (status && !JOB_STATUSES.includes(status as JobStatus)) {
      return errorResponse(400, "INVALID_REQUEST", "Unknown status filter.");
    }
    const jobs = await listJobs(user.sub, {
      arrangement: arrangement as Arrangement | undefined,
      status: status as JobStatus | undefined,
    });
    return jsonResponse(200, { jobs });
  } catch (err) {
    context.error("jobs list failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Storage failed. Please try again.");
  }
}

/** GET/PUT/PATCH/DELETE /api/jobs/{key} ← get/save/update/remove. */
export async function jobsItemHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  if (request.method === "OPTIONS") return preflightResponse();
  const key = request.params.key ?? "";
  if (!/^[0-9a-f]{64}$/.test(key)) {
    return errorResponse(400, "INVALID_REQUEST", "Malformed job key.");
  }

  try {
    switch (request.method) {
      case "GET": {
        const job = await getJob(user.sub, key);
        if (!job) return errorResponse(404, "JOB_NOT_FOUND", "No such saved job.");
        return jsonResponse(200, job);
      }
      case "PUT": {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse(400, "INVALID_REQUEST", "Body must be valid JSON.");
        }
        if (!isSavedJobPutBody(body)) {
          return errorResponse(400, "INVALID_REQUEST", "Malformed saved-job record.");
        }
        try {
          return jsonResponse(200, await saveJob(user.sub, key, body));
        } catch (err) {
          if (err instanceof KeyMismatchError) {
            return errorResponse(400, "INVALID_REQUEST", err.message);
          }
          if (err instanceof LibraryCapError) {
            return errorResponse(409, "LIBRARY_FULL", err.message);
          }
          throw err;
        }
      }
      case "PATCH": {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse(400, "INVALID_REQUEST", "Body must be valid JSON.");
        }
        if (!isSavedJobPatchBody(body)) {
          return errorResponse(400, "INVALID_REQUEST", "Malformed job patch.");
        }
        try {
          const updated = await patchJob(user.sub, key, body);
          if (!updated) {
            return errorResponse(404, "JOB_NOT_FOUND", "No such saved job.");
          }
          return jsonResponse(200, updated);
        } catch (err) {
          if (err instanceof ImmutableFieldError) {
            return errorResponse(400, "INVALID_REQUEST", err.message);
          }
          throw err;
        }
      }
      case "DELETE": {
        await deleteJob(user.sub, key);
        return noContent();
      }
      default:
        return errorResponse(405, "INVALID_REQUEST", "Method not allowed.");
    }
  } catch (err) {
    context.error("jobs item failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Storage failed. Please try again.");
  }
}

/** GET /api/jobs/export ← exportAll(); byte-compatible with the local format. */
export async function jobsExportHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  if (request.method === "OPTIONS") return preflightResponse();
  try {
    const exported = await exportJobs(user.sub);
    return {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Disposition": 'attachment; filename="saved-jobs.json"',
      },
      // Serialized exactly like the current local exportAll (FR-009).
      body: JSON.stringify(exported, null, 2),
    };
  } catch (err) {
    context.error("jobs export failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Export failed. Please try again.");
  }
}

/** POST /api/jobs/prune ← pruneArchived(count). */
export async function jobsPruneHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  if (request.method === "OPTIONS") return preflightResponse();
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "INVALID_REQUEST", "Body must be valid JSON.");
    }
    const count = (body as { count?: unknown })?.count;
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 1000
    ) {
      return errorResponse(400, "INVALID_REQUEST", "count must be an integer 1–1000.");
    }
    return jsonResponse(200, { pruned: await pruneArchived(user.sub, count) });
  } catch (err) {
    context.error("jobs prune failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Prune failed. Please try again.");
  }
}

const preflight = () => ({ status: 204, headers: corsHeaders() });

app.http("jobs-collection", {
  methods: ["GET"],
  authLevel: "function",
  route: "jobs",
  handler: withAuth(jobsCollectionHandler),
});
app.http("jobs-collection-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "jobs",
  handler: preflight,
});

// Static routes must be registered before/next to the parameterized twin;
// the Functions host prefers literal segments over {key}.
app.http("jobs-export", {
  methods: ["GET"],
  authLevel: "function",
  route: "jobs/export",
  handler: withAuth(jobsExportHandler),
});
app.http("jobs-export-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "jobs/export",
  handler: preflight,
});

app.http("jobs-prune", {
  methods: ["POST"],
  authLevel: "function",
  route: "jobs/prune",
  handler: withAuth(jobsPruneHandler),
});
app.http("jobs-prune-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "jobs/prune",
  handler: preflight,
});

app.http("jobs-item", {
  methods: ["GET", "PUT", "PATCH", "DELETE"],
  authLevel: "function",
  route: "jobs/{key}",
  handler: withAuth(jobsItemHandler),
});
app.http("jobs-item-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "jobs/{key}",
  handler: preflight,
});
