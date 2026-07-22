import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

function makeFile(name: string, type: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

async function uploadFile(file: File) {
  const input = await screen.findByLabelText(/upload a document/i);
  await userEvent.upload(input, file);
}

describe("document upload errors (contracts/analyze-document.md, FR-020/FR-023)", () => {
  const api = installFakeApi();

  it("413 FILE_TOO_LARGE renders the plain-language size error", async () => {
    seedSession();
    api.failNext("analyze-document", {
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "File exceeds the 10 MB limit.",
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    await uploadFile(makeFile("big.pdf", "application/pdf"));
    await screen.findByText(/10 MB limit/i);
  });

  it("415 UNSUPPORTED_FILE_TYPE renders the plain-language format error", async () => {
    seedSession();
    api.failNext("analyze-document", {
      status: 415,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Only .docx and .pdf files are supported.",
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    await uploadFile(makeFile("mislabeled.pdf", "application/pdf"));
    await screen.findByText(/\.docx and \.pdf/i);
  });

  it("422 FILE_NO_TEXT renders the plain-language unreadable-document error", async () => {
    seedSession();
    api.failNext("analyze-document", {
      status: 422,
      code: "FILE_NO_TEXT",
      message: "No text could be extracted from this document.",
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    await uploadFile(makeFile("scan.pdf", "application/pdf"));
    await screen.findByText(/no text could be extracted/i);
  });

  it("429 USAGE_LIMIT_REACHED renders the reset-date exhaustion state with an upgrade path", async () => {
    seedSession();
    api.failNext("analyze-document", {
      status: 429,
      code: "USAGE_LIMIT_REACHED",
      message: "You've used all 50 free analyses this month. Your allowance resets on August 1.",
      usage: { count: 50, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z", tier: "free" },
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    await uploadFile(makeFile("job.pdf", "application/pdf"));
    await screen.findByText(/resets on august 1/i);
    expect(screen.getByRole("link", { name: /upgrade/i })).toBeInTheDocument();
  });
});
