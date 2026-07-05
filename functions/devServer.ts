/**
 * Minimal local dev server — wraps analyzeJobHandler without needing the func CLI.
 * Usage: npx tsx devServer.ts
 */
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync } from "fs";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { analyzeJobHandler } from "./src/analyze-job/index";

// Load env vars from local.settings.json (same as func CLI does)
try {
  const settings = JSON.parse(readFileSync("./local.settings.json", "utf-8")) as {
    Values?: Record<string, string>;
  };
  for (const [k, v] of Object.entries(settings.Values ?? {})) {
    process.env[k] = v;
  }
} catch {
  console.warn("Could not load local.settings.json");
}

const PORT = 7071;

function makeContext(): InvocationContext {
  return {
    log: (...args: unknown[]) => console.log("[func]", ...args),
    error: (...args: unknown[]) => console.error("[func]", ...args),
    warn: (...args: unknown[]) => console.warn("[func]", ...args),
    invocationId: "local",
    functionName: "analyze-job",
    extraInputs: { get: () => undefined },
    extraOutputs: { set: () => {} },
    options: {},
  } as unknown as InvocationContext;
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function makeRequest(rawBody: string, req: IncomingMessage): HttpRequest {
  const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
  return {
    method: req.method ?? "POST",
    url: `http://localhost:${PORT}${req.url}`,
    headers: new Headers(req.headers as Record<string, string>),
    json: async () => parsed,
    text: async () => rawBody,
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
    formData: async () => new FormData(),
    blob: async () => new Blob(),
  } as unknown as HttpRequest;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers["origin"] ?? "*";

  // CORS pre-flight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-functions-key",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/analyze-job")) {
    try {
      const rawBody = await bodyOf(req);
      const azReq = makeRequest(rawBody, req);
      const azRes = await analyzeJobHandler(azReq, makeContext());

      res.writeHead(azRes.status ?? 200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        ...(azRes.headers as Record<string, string> | undefined),
      });
      res.end(JSON.stringify(azRes.jsonBody));
    } catch (err) {
      console.error("Handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "service-error", message: "Internal error" } }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`\nDev server running at http://localhost:${PORT}/api/analyze-job`);
  console.log("Press Ctrl+C to stop.\n");
});
