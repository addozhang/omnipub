import { vi, beforeEach } from "vitest";

const createEvent = () => ({
  addListener: vi.fn(),
});

const createStorageArea = () => {
  let store = {};
  return {
    get: vi.fn(async (keys) => {
      if (!keys) return { ...store };
      if (Array.isArray(keys)) {
        return keys.reduce((acc, key) => {
          acc[key] = store[key];
          return acc;
        }, {});
      }
      if (typeof keys === "string") {
        return { [keys]: store[keys] };
      }
      if (typeof keys === "object") {
        return Object.keys(keys).reduce((acc, key) => {
          acc[key] = store[key] ?? keys[key];
          return acc;
        }, {});
      }
      return { ...store };
    }),
    set: vi.fn(async (items) => {
      store = { ...store, ...items };
    }),
    remove: vi.fn(async (key) => {
      if (Array.isArray(key)) {
        key.forEach((k) => delete store[k]);
        return;
      }
      delete store[key];
    }),
    __reset: () => {
      store = {};
    },
    __getStore: () => ({ ...store }),
  };
};

const createChromeMock = () => {
  const storageArea = createStorageArea();

  return {
    storage: {
      local: storageArea,
      session: createStorageArea(),
    },
    tabs: {
      create: vi.fn(async () => ({ id: 1 })),
      sendMessage: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      onUpdated: createEvent(),
      onRemoved: createEvent(),
    },
    runtime: {
      onMessage: createEvent(),
      onMessageExternal: createEvent(),
      onInstalled: createEvent(),
      onStartup: createEvent(),
      getManifest: vi.fn(() => ({ version: "1.0.0" })),
    },
    scripting: {
      registerContentScripts: vi.fn(async () => undefined),
      unregisterContentScripts: vi.fn(async () => undefined),
    },
    cookies: {
      getAll: vi.fn(async () => []),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: createEvent(),
    },
    __storage: storageArea,
  };
};

beforeEach(() => {
  vi.restoreAllMocks();
  const chromeMock = createChromeMock();
  global.chrome = chromeMock;
  global.fetch = vi.fn();
  global.importScripts = vi.fn();
  chromeMock.__storage.__reset();
});
