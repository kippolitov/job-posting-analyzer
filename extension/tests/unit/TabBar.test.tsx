import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar } from "../../components/shared/TabBar";

const tabs = [
  { id: "summary", label: "Summary" },
  { id: "chat", label: "Chat" },
];

describe("TabBar", () => {
  it("renders a tablist with one tab per entry", () => {
    render(<TabBar tabs={tabs} activeTab="summary" onTabChange={vi.fn()} />);
    expect(screen.getByRole("tablist", { name: "Panel sections" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("marks only the active tab as selected", () => {
    render(<TabBar tabs={tabs} activeTab="chat" onTabChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  });

  it("wires aria-controls and id for each tab", () => {
    render(<TabBar tabs={tabs} activeTab="summary" onTabChange={vi.fn()} />);
    const summaryTab = screen.getByRole("tab", { name: "Summary" });
    expect(summaryTab).toHaveAttribute("id", "tab-summary");
    expect(summaryTab).toHaveAttribute("aria-controls", "panel-summary");
  });

  it("calls onTabChange with the clicked tab id", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(<TabBar tabs={tabs} activeTab="summary" onTabChange={onTabChange} />);

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    expect(onTabChange).toHaveBeenCalledWith("chat");
  });

  it("still renders exactly 2 tabs when a sibling action is passed as children (FR-017a)", () => {
    render(
      <TabBar tabs={tabs} activeTab="summary" onTabChange={vi.fn()}>
        <button>Paste text</button>
      </TabBar>
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("disables the tabs — unreachable by pointer or keyboard — when tabsDisabled is set (FR-017b)", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TabBar tabs={tabs} activeTab="summary" onTabChange={onTabChange} tabsDisabled />
    );
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    expect(chatTab).toBeDisabled();
    await user.click(chatTab);
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("renders children as a sibling of the tablist, not a child of it (FR-017a)", () => {
    render(
      <TabBar tabs={tabs} activeTab="summary" onTabChange={vi.fn()}>
        <button>Paste text</button>
      </TabBar>
    );
    const tablist = screen.getByRole("tablist");
    const pasteButton = screen.getByRole("button", { name: "Paste text" });
    expect(tablist).not.toContainElement(pasteButton);
  });
});
