import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { pickerPageScript } from "../../services/pickerService";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

// jsdom does not implement scrolling (window.scrollTo is a documented no-op
// there) — stub it with a real position so scroll-restoration assertions
// (FR-025) can observe something other than a permanent 0.
let scrollPos = { x: 0, y: 0 };
function fakeScrollTo(x: number, y: number): void {
  scrollPos = { x, y };
}

beforeEach(() => {
  scrollPos = { x: 0, y: 0 };
  vi.spyOn(window, "scrollTo").mockImplementation(
    (...args: unknown[]) => {
      if (typeof args[0] === "number") fakeScrollTo(args[0], args[1] as number);
      else fakeScrollTo((args[0] as ScrollToOptions).left ?? 0, (args[0] as ScrollToOptions).top ?? 0);
    }
  );
  vi.spyOn(window, "scrollX", "get").mockImplementation(() => scrollPos.x);
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollPos.y);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("pickerPageScript — list (FR-024b)", () => {
  it("ranks candidates by the FR-012 score and excludes below-minimum text", async () => {
    setBody(`
      <nav class="cookie-banner">${"cookie ".repeat(60)}</nav>
      <main>${"Job posting content describing the role in detail. ".repeat(20)}</main>
      <div class="short">too short</div>
    `);
    const result = await pickerPageScript({ type: "list" });
    expect(result.kind).toBe("candidates");
    if (result.kind !== "candidates") throw new Error("unreachable");
    expect(result.candidates.length).toBeGreaterThan(0);
    // No id/class on <main> here, so the generator falls through to
    // tag:nth-of-type(n) — the same behavior lib/selectorPath.ts's own
    // tests assert for a plain element with no other anchor.
    expect(result.candidates[0].selector).toBe("main:nth-of-type(1)");
    expect(result.candidates.some((c) => c.label.toLowerCase().includes("cookie"))).toBe(
      false
    );
  });

  it("caps the list and dedupes near-identical nested wrappers", async () => {
    // A wrapper div whose only child carries (almost) all the same text
    // should not double the list — it offers the user no new information.
    setBody(
      `<div class="wrapper"><article>${"Long job description text here. ".repeat(
        30
      )}</article></div>`
    );
    const result = await pickerPageScript({ type: "list" });
    if (result.kind !== "candidates") throw new Error("unreachable");
    expect(result.candidates.length).toBe(1);
  });

  it("gives each candidate a label, text length, and excerpt", async () => {
    setBody(`<article>${"Posting body content. ".repeat(30)}</article>`);
    const result = await pickerPageScript({ type: "list" });
    if (result.kind !== "candidates") throw new Error("unreachable");
    const [candidate] = result.candidates;
    expect(candidate.label).toBe("Article");
    expect(candidate.textLength).toBeGreaterThan(0);
    expect(candidate.excerpt.length).toBeGreaterThan(0);
    expect(candidate.excerpt.length).toBeLessThanOrEqual(121); // EXCERPT_MAX + ellipsis
  });
});

describe("pickerPageScript — resolveText (stale-list edge case)", () => {
  it("re-resolves live text rather than trusting a stale snapshot", async () => {
    setBody(`<article id="post">${"Original content. ".repeat(30)}</article>`);
    document.getElementById("post")!.textContent = "Updated content. ".repeat(30);
    const result = await pickerPageScript({ type: "resolveText", selector: "#post" });
    expect(result.kind).toBe("commit");
    if (result.kind !== "commit") throw new Error("unreachable");
    expect(result.outcome.ok).toBe(true);
    if (!result.outcome.ok) throw new Error("unreachable");
    expect(result.outcome.text).toContain("Updated content");
  });

  it("fails with an explanation when the selector no longer matches", async () => {
    setBody("<article>gone</article>");
    const result = await pickerPageScript({ type: "resolveText", selector: "#missing" });
    if (result.kind !== "commit") throw new Error("unreachable");
    expect(result.outcome).toEqual({
      ok: false,
      reason: "This region is no longer on the page. Choose another one from the list.",
    });
  });
});

describe("pickerPageScript — highlight / clearHighlight (FR-024c, FR-025)", () => {
  it("applies a non-color-only highlight style to the target", async () => {
    setBody(`<article id="post">${"Content. ".repeat(30)}</article>`);
    await pickerPageScript({ type: "highlight", selector: "#post" });
    const el = document.getElementById("post")!;
    expect(el.style.outline).toContain("solid");
    expect(el.style.boxShadow.length).toBeGreaterThan(0);
    expect(el.getAttribute("data-jpa-picker-highlight")).toBe("true");
  });

  it("repeated highlight calls do not corrupt the remembered scroll origin", async () => {
    setBody(`
      <article id="a">${"A ".repeat(400)}</article>
      <article id="b">${"B ".repeat(400)}</article>
    `);
    window.scrollTo(0, 123);
    await pickerPageScript({ type: "beginSession" });
    await pickerPageScript({ type: "highlight", selector: "#a" });
    window.scrollTo(0, 456); // simulate scrollIntoView moving the page
    await pickerPageScript({ type: "highlight", selector: "#b" });
    window.scrollTo(0, 789);
    await pickerPageScript({ type: "clearHighlight" });
    expect(window.scrollY).toBe(123);
  });

  it("clearHighlight removes styling and the cursor override", async () => {
    setBody(`<article id="post">${"Content. ".repeat(30)}</article>`);
    await pickerPageScript({ type: "highlight", selector: "#post" });
    await pickerPageScript({ type: "clearHighlight" });
    const el = document.getElementById("post")!;
    expect(el.style.outline).toBe("");
    expect(el.getAttribute("data-jpa-picker-highlight")).toBeNull();
    expect(document.body.style.cursor).toBe("");
  });
});

describe("pickerPageScript — pointerPick (FR-024, FR-025)", () => {
  it("commits the element under the cursor on click without restoring scroll", async () => {
    setBody(`<article id="post">${"Content. ".repeat(30)}</article>`);
    const el = document.getElementById("post")!;
    el.getBoundingClientRect = () =>
      ({ width: 500, height: 500, top: 0, left: 0, right: 500, bottom: 500 }) as DOMRect;
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element }).elementFromPoint =
      () => el;
    window.scrollTo(0, 50);

    const pending = pickerPageScript({ type: "pointerPick" });
    document.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
    const result = await pending;

    expect(result.kind).toBe("pointerPick");
    if (result.kind !== "pointerPick") throw new Error("unreachable");
    expect(result.outcome).toEqual({ ok: true, text: expect.stringContaining("Content"), selector: "#post" });
    // Commit is not a dismissal — scroll position is left where it was.
    expect(window.scrollY).toBe(50);
  });

  it("dismisses on Escape and restores the original scroll position", async () => {
    setBody(`<article id="post">${"Content. ".repeat(30)}</article>`);
    window.scrollTo(0, 77);

    const pending = pickerPageScript({ type: "pointerPick" });
    window.scrollTo(0, 999);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const result = await pending;

    expect(result.kind).toBe("pointerPick");
    if (result.kind !== "pointerPick") throw new Error("unreachable");
    expect(result.outcome).toEqual({ ok: false, reason: "dismissed" });
    expect(window.scrollY).toBe(77);
    expect(document.body.style.cursor).toBe("");
  });
});
