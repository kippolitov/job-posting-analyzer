/**
 * Document-upload extraction (contracts/analyze-document.md steps 1–3,
 * research.md R4/R6): inline magic-byte sniff, 10 MB boundary, mammoth
 * (.docx) / unpdf (.pdf) extraction, encrypted/image-only/corrupt
 * detection. Every rejection here happens BEFORE metering (research R7) —
 * callers must not call checkAndIncrement until extractDocument resolves.
 */

export type DocumentRejectionCode =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_PASSWORD_PROTECTED"
  | "FILE_UNREADABLE"
  | "FILE_NO_TEXT";

export class DocumentRejectedError extends Error {
  readonly code: DocumentRejectionCode;
  constructor(code: DocumentRejectionCode, message: string) {
    super(message);
    this.name = "DocumentRejectedError";
    this.code = code;
  }
}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

type DocumentType = "pdf" | "docx";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 (ZIP/OOXML)
// OLE2/Compound File header — the standard signature Office writes for a
// password-protected (Agile-encrypted) .docx, which is not a ZIP at all.
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Buffer, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function sniffType(bytes: Buffer): DocumentType {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, ZIP_MAGIC)) return "docx";
  if (startsWith(bytes, OLE2_MAGIC)) {
    throw new DocumentRejectedError(
      "FILE_PASSWORD_PROTECTED",
      "This document is password-protected. Remove the password and try again."
    );
  }
  throw new DocumentRejectedError(
    "UNSUPPORTED_FILE_TYPE",
    "Only .docx and .pdf files are supported."
  );
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const result = await extractText(pdf, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new DocumentRejectedError(
        "FILE_PASSWORD_PROTECTED",
        "This document is password-protected. Remove the password and try again."
      );
    }
    throw new DocumentRejectedError(
      "FILE_UNREADABLE",
      "This PDF could not be read. It may be corrupt."
    );
  }
  return text;
}

async function extractDocxText(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  try {
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value;
  } catch {
    throw new DocumentRejectedError(
      "FILE_UNREADABLE",
      "This document could not be read. It may be corrupt."
    );
  }
}

export interface ExtractionResult {
  text: string;
  type: DocumentType;
}

/**
 * Ordered per the contract: size → sniff → extract → empty-text check.
 * Every failure path throws DocumentRejectedError before any allowance is
 * touched (SC-005) — callers must not have called checkAndIncrement yet.
 */
export async function extractDocument(bytes: Buffer): Promise<ExtractionResult> {
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentRejectedError(
      "FILE_TOO_LARGE",
      `File exceeds the ${(MAX_DOCUMENT_BYTES / (1024 * 1024)).toFixed(0)} MB limit.`
    );
  }

  const type = sniffType(bytes);
  const text = type === "pdf" ? await extractPdfText(bytes) : await extractDocxText(bytes);

  if (text.trim().length === 0) {
    throw new DocumentRejectedError(
      "FILE_NO_TEXT",
      "No text could be extracted from this document. If it's a scanned image, OCR is not yet supported."
    );
  }

  return { text, type };
}
