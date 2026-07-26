import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegionList } from "../../components/JobPanel/RegionList";
import { pickerService } from "../../services/pickerService";
import type { PickerCandidate } from "../../services/pickerService";

vi.mock("../../services/pickerService", () => ({
  pickerService: {
    beginSession: vi.fn(async () => {}),
    listCandidates: vi.fn(),
    highlightCandidate: vi.fn(async () => {}),
    clearPickerHighlight: vi.fn(async () => {}),
    resolveCandidateText: vi.fn(),
    startPointerPick: vi.fn(),
  },
}));

const candidates: PickerCandidate[] = [
  {
    selector: "main",
    label: "Main content",
    textLength: 4200,
    excerpt: "We are looking for a senior engineer to join our team…",
  },
  {
    selector: "article.body",
    label: "Article",
    textLength: 1800,
    excerpt: "About the role: you will build things…",
  },
];

const mockedPicker = vi.mocked(pickerService);

beforeEach(() => {
  vi.clearAllMocks();
  mockedPicker.listCandidates.mockResolvedValue(candidates);
  mockedPicker.resolveCandidateText.mockResolvedValue({ ok: true, text: "resolved text" });
});

/**
 * SC-011 gate: the entire flow is driven with keyboard events only — no
 * `.click()` anywhere. A test reaching for click() has stopped testing
 * WCAG 2.1.1 (FR-024a).
 */
describe("RegionList (FR-024a, FR-024b, SC-011)", () => {
  it("begins a picker session and lists candidates on mount", async () => {
    render(<RegionList tabId={7} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findAllByText("Main content", { exact: false })).not.toHaveLength(0);
    expect(mockedPicker.beginSession).toHaveBeenCalledWith(7);
    expect(mockedPicker.listCandidates).toHaveBeenCalledWith(7);
  });

  it("exposes each candidate's label, length, and excerpt in its accessible name", async () => {
    render(<RegionList tabId={7} onCommit={vi.fn()} onCancel={vi.fn()} />);
    const option = await screen.findByRole("option", { name: /Main content.*4,200 characters.*looking for a senior engineer/s });
    expect(option).toBeInTheDocument();
  });

  it("moves the active candidate with arrow keys and highlights it on the page", async () => {
    const user = userEvent.setup();
    render(<RegionList tabId={7} onCommit={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}");

    expect(mockedPicker.highlightCandidate).toHaveBeenLastCalledWith(7, "article.body");
  });

  it("commits the active candidate on Enter, re-resolving its text live", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<RegionList tabId={7} onCommit={onCommit} onCancel={vi.fn()} />);
    await screen.findByRole("listbox");

    await user.keyboard("{Enter}");

    expect(mockedPicker.resolveCandidateText).toHaveBeenCalledWith(7, "main");
    expect(onCommit).toHaveBeenCalledWith({ text: "resolved text", selector: "main" });
  });

  it("shows a plain-language message and does not commit when the region is stale", async () => {
    mockedPicker.resolveCandidateText.mockResolvedValue({
      ok: false,
      reason: "This region is no longer on the page. Choose another one from the list.",
    });
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<RegionList tabId={7} onCommit={onCommit} onCancel={vi.fn()} />);
    await screen.findByRole("listbox");

    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This region is no longer on the page. Choose another one from the list."
    );
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels on Escape without committing, and clears the page highlight", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<RegionList tabId={7} onCommit={vi.fn()} onCancel={onCancel} />);
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalled();
    expect(mockedPicker.clearPickerHighlight).toHaveBeenCalledWith(7);
  });

  it("shows a plain-language empty state with a next action when no regions are found", async () => {
    mockedPicker.listCandidates.mockResolvedValue([]);
    render(<RegionList tabId={7} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(
      await screen.findByText(/no regions were found/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/analyze selection/i)).toBeInTheDocument();
  });
});
