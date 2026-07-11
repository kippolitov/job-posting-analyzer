import "@testing-library/jest-dom";

// Node 22+ defines an experimental global `localStorage` that is undefined
// unless --localstorage-file is passed; it shadows jsdom's implementation
// (vitest's populateGlobal skips keys already present on globalThis).
// Install an in-memory Storage stub so bare `localStorage` works in tests.
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    writable: true,
    configurable: true,
  });
}

// Minimal chrome API stub for unit tests
const chromeMock = {
  storage: {
    session: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  scripting: {
    executeScript: vi.fn(),
  },
  identity: {
    getRedirectURL: vi.fn(() => "https://extension-id.chromiumapp.org/"),
    launchWebAuthFlow: vi.fn(),
  },
  sidePanel: {
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined),
  },
  action: {
    onClicked: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;

// jsdom does not implement matchMedia (used by useTheme)
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}

// jsdom does not implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
