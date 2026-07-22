import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  extractDocument,
  DocumentRejectedError,
  MAX_DOCUMENT_BYTES,
} from "../../src/services/documentExtraction";

const FIXTURES = path.join(__dirname, "..", "fixtures", "documents");

function fixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES, name));
}

describe("documentExtraction (contracts/analyze-document.md steps 1–3)", () => {
  it("extracts real text from a valid .docx", async () => {
    const result = await extractDocument(fixture("valid.docx"));
    expect(result.type).toBe("docx");
    expect(result.text).toMatch(/Senior Backend Engineer/i);
  });

  it("extracts real text from a valid .pdf", async () => {
    const result = await extractDocument(fixture("valid.pdf"));
    expect(result.type).toBe("pdf");
    expect(result.text).toMatch(/Senior Backend Engineer/i);
  });

  it("rejects a file over the 10 MB boundary with FILE_TOO_LARGE — before any sniff", async () => {
    const oversized = fixture("oversized.pdf");
    expect(oversized.length).toBeGreaterThan(MAX_DOCUMENT_BYTES);
    await expect(extractDocument(oversized)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("rejects mislabeled bytes (not real PDF/DOCX magic bytes) with UNSUPPORTED_FILE_TYPE", async () => {
    await expect(extractDocument(fixture("mislabeled.pdf"))).rejects.toMatchObject({
      code: "UNSUPPORTED_FILE_TYPE",
    });
  });

  it("rejects a password-protected .pdf with FILE_PASSWORD_PROTECTED", async () => {
    await expect(extractDocument(fixture("encrypted.pdf"))).rejects.toMatchObject({
      code: "FILE_PASSWORD_PROTECTED",
    });
  });

  it("rejects a password-protected .docx (OLE2 container) with FILE_PASSWORD_PROTECTED", async () => {
    await expect(extractDocument(fixture("encrypted.docx"))).rejects.toMatchObject({
      code: "FILE_PASSWORD_PROTECTED",
    });
  });

  it("rejects an image-only PDF (no extractable text) with FILE_NO_TEXT", async () => {
    await expect(extractDocument(fixture("image-only.pdf"))).rejects.toMatchObject({
      code: "FILE_NO_TEXT",
    });
  });

  it("DocumentRejectedError carries a plain-language message", async () => {
    try {
      await extractDocument(fixture("encrypted.pdf"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentRejectedError);
      expect((err as DocumentRejectedError).message.length).toBeGreaterThan(0);
    }
  });
});
