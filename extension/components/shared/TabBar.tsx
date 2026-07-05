interface Tab {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Panel sections"
      className="flex shrink-0 gap-1 border-b border-gray-200/70 bg-white px-3 py-1.5 dark:border-gray-800 dark:bg-gray-900"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-all ${
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
  );
}
