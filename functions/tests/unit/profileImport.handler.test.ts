import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { profileImportHandler } from "../../src/profile/index";
import * as tables from "../../src/services/tablesService";
import * as metering from "../../src/services/meteringService";
import { extractDocument } from "../../src/services/documentExtraction";

/** contracts/profile-api.md §4: import makes no model call, no metering, no storage (R12). */
const FIXTURES = path.join(__dirname, "..", "fixtures", "documents");
const user = { sub: "import-sub", email: "user@example.com", tier: "free" as const };

function fixture(name: string): Blob {
  return new Blob([readFileSync(path.join(FIXTURES, name))]);
}

function request(parts: Record<string, string | Blob>): HttpRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(parts)) form.set(k, v);
  return {
    method: "POST",
    headers: { get: () => null },
    formData: () => Promise.resolve(form),
  } as unknown as HttpRequest;
}

function makeContext() {
  return { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
}

async function importFile(name: string, context = makeContext()) {
  return profileImportHandler(
    request({ file: fixture(name) }),
    context as unknown as InvocationContext,
    user
  );
}

describe("POST /api/profile/import", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each(["valid.pdf", "valid.docx"])("returns the extracted text of %s", async (name) => {
    const res = await importFile(name);
    expect(res.status).toBe(200);
    const body = res.jsonBody as { text: string; charCount: number };
    expect(body.text).toMatch(/Senior Backend Engineer/i);
    expect(body.charCount).toBe(body.text.length);
  });

  it.each([
    ["oversized.pdf", 413, "FILE_TOO_LARGE"],
    ["mislabeled.pdf", 415, "UNSUPPORTED_FILE_TYPE"],
    ["encrypted.pdf", 422, "FILE_PASSWORD_PROTECTED"],
    ["encrypted.docx", 422, "FILE_PASSWORD_PROTECTED"],
    ["image-only.pdf", 422, "FILE_NO_TEXT"],
  ])("rejects %s with %i %s", async (name, status, code) => {
    const res = await importFile(name);
    expect(res.status).toBe(status);
    expect(res.jsonBody).toMatchObject({ error: { code } });
  });

  it("uses the same message as analyze-document for a no-text file", async () => {
    const expected = await extractDocument(
      Buffer.from(await fixture("image-only.pdf").arrayBuffer())
    ).catch((e: Error) => e.message);
    const res = await importFile("image-only.pdf");
    expect(res.jsonBody).toMatchObject({ error: { message: expected } });
  });

  it("returns 400 when there is no file part", async () => {
    const res = await profileImportHandler(
      request({ text: "not a file" }),
      makeContext() as unknown as InvocationContext,
      user
    );
    expect(res.status).toBe(400);
  });

  it("touches no table and no metering (R12)", async () => {
    const ensureTable = vi.spyOn(tables, "ensureTable");
    const charge = vi.spyOn(metering, "chargeAnalysis");
    await importFile("valid.pdf");
    expect(ensureTable).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("never logs the extracted text", async () => {
    const context = makeContext();
    await importFile("valid.pdf", context);
    const logged = JSON.stringify([
      context.log.mock.calls,
      context.warn.mock.calls,
      context.error.mock.calls,
    ]);
    expect(logged).not.toMatch(/Senior Backend Engineer/i);
  });

  it("returns text above 20,000 characters whole", async () => {
    const long = "Senior Backend Engineer. ".repeat(1_000);
    vi.spyOn(await import("../../src/services/documentExtraction"), "extractDocument")
      .mockResolvedValue({ type: "pdf", text: long });
    const res = await importFile("valid.pdf");
    expect(res.status).toBe(200);
    expect((res.jsonBody as { charCount: number }).charCount).toBe(long.length);
  });
});
