const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => {
    store[key] = String(value);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  }),
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

if (typeof window !== "undefined" && window.dispatchEvent) {
  vi.spyOn(window, "dispatchEvent");
}
