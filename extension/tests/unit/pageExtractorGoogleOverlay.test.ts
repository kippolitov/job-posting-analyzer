// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.google.com/search?q=senior+software+engineer+remote"}
import { describe, it, expect, beforeEach } from "vitest";
import { extractPage } from "../../lib/pageExtractor";

const JOB_TEXT =
  "Sr. Software Engineer (Remote) — Inspira Financial · Chicago, IL. " +
  "Job description: We are seeking talented Senior Software Engineers who can " +
  "create complex .NET back-end solutions and scalable user experiences. " +
  "Responsibilities: join a cross-functional, DevOps based, Agile team " +
  "responsible for the entire product development life cycle. " +
  "Qualifications: expertise in both front-end and back-end coding languages.";

const LIST_TEXT = `Search results. ${"Another job teaser in the list. ".repeat(40)}`;

function makeVisible(element: HTMLElement, width = 500, height = 700): void {
  // jsdom reports zero-size rects for everything; the extractor uses the
  // rect to tell the open detail pane apart from Google's hidden dialogs.
  element.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
}

describe("pageExtractor — Google job-detail overlay", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("prefers the visible job dialog over the results list", () => {
    document.body.innerHTML = `
      <main>${LIST_TEXT}</main>
      <div role="dialog" id="detail">${JOB_TEXT}</div>`;
    makeVisible(document.getElementById("detail")!);

    const { mainText } = extractPage();
    expect(mainText).toContain("Inspira Financial");
    expect(mainText).not.toContain("Another job teaser");
  });

  it("ignores zero-size (hidden) dialogs", () => {
    document.body.innerHTML = `
      <main>${LIST_TEXT}</main>
      <div role="dialog">${JOB_TEXT}</div>`;

    const { mainText } = extractPage();
    expect(mainText).toContain("Another job teaser");
  });

  it("falls back to the page when the visible dialog text is thin", () => {
    document.body.innerHTML = `
      <main>${LIST_TEXT}</main>
      <div role="dialog" id="detail">Date posted</div>`;
    makeVisible(document.getElementById("detail")!);

    const { mainText } = extractPage();
    expect(mainText).toContain("Another job teaser");
  });

  it("picks the largest of several visible dialogs", () => {
    document.body.innerHTML = `
      <main>${LIST_TEXT}</main>
      <div role="dialog" id="chip">${"Filter chips dialog text. ".repeat(12)}</div>
      <div role="dialog" id="detail">${JOB_TEXT}</div>`;
    makeVisible(document.getElementById("chip")!);
    makeVisible(document.getElementById("detail")!);

    const { mainText } = extractPage();
    expect(mainText).toContain("Inspira Financial");
    expect(mainText).not.toContain("Filter chips");
  });
});
