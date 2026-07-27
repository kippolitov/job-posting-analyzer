import type { ReactNode } from "react";

interface Tab {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /**
   * Non-tab actions that sit beside the tablist (spec FR-017, FR-017a) — the
   * paste button. Rendered as a SIBLING of `role="tablist"`, never a child of
   * it: every child of a tablist is announced as a tab, and a plain button
   * inside it would misrepresent the panel's structure to assistive
   * technology. This header row is what makes that possible — a flex
   * container holding the tablist and these children side by side.
   */
  children?: ReactNode;
  /**
   * True while the paste composer is open (spec FR-017b): the tabs MUST NOT
   * be reachable by pointer or keyboard, since their panel is hidden and a
   * click on either would be a silent no-op. `disabled` removes a button
   * from both the click surface and the tab order in one attribute.
   */
  tabsDisabled?: boolean;
}

export function TabBar({ tabs, activeTab, onTabChange, children, tabsDisabled }: TabBarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-1 border-b border-gray-200/70 bg-white px-3 py-1.5 dark:border-gray-800 dark:bg-gray-900">
      <div role="tablist" aria-label="Panel sections" className="flex gap-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              disabled={tabsDisabled}
              onClick={() => onTabChange(tab.id)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-40 ${
                isActive
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
