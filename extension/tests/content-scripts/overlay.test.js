import { beforeEach, describe, expect, it, vi } from "vitest";

const createDom = () => {
  const elements = [];
  const body = {
    appendChild: vi.fn((el) => {
      el.parentNode = body;
    }),
    removeChild: vi.fn((el) => {
      el.parentNode = null;
    }),
  };
  const head = {
    appendChild: vi.fn(),
  };
  const createElement = vi.fn((tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      textContent: "",
      id: "",
      parentNode: null,
      offsetHeight: 0,
      appendChild: vi.fn((child) => {
        child.parentNode = el;
      }),
      addEventListener: vi.fn(),
    };
    elements.push(el);
    return el;
  });

  global.document = {
    body,
    head,
    createElement,
  };

  return { elements, body, head };
};

const loadOverlay = async () => {
  await import("../../content-scripts/common/overlay.js");
  return {
    showOverlay: window.showOverlay,
    hideOverlay: window.hideOverlay,
    updateOverlay: window.updateOverlay,
  };
};

describe("overlay", () => {
  beforeEach(() => {
    vi.resetModules();
    global.window = {};
  });

  it("showOverlay creates overlay element and appends to body", async () => {
    const { elements, body } = createDom();
    const { showOverlay } = await loadOverlay();
    showOverlay("Hello");
    const overlay = elements.find((el) => el.id === "mp-publisher-overlay");
    expect(overlay).toBeTruthy();
    expect(body.appendChild).toHaveBeenCalledWith(overlay);
    expect(overlay.style.opacity).toBe("1");
  });

  it("showOverlay sets message text", async () => {
    const { elements } = createDom();
    const { showOverlay } = await loadOverlay();
    showOverlay("填充中");
    const message = elements.find((el) => el.textContent === "填充中");
    expect(message).toBeTruthy();
  });

  it("hideOverlay sets opacity to 0 and removes element", async () => {
    vi.useFakeTimers();
    const { elements, body } = createDom();
    const { showOverlay, hideOverlay } = await loadOverlay();
    showOverlay("Test");
    const overlay = elements.find((el) => el.id === "mp-publisher-overlay");
    hideOverlay();
    expect(overlay.style.opacity).toBe("0");
    vi.advanceTimersByTime(300);
    expect(body.removeChild).toHaveBeenCalledWith(overlay);
    vi.useRealTimers();
  });

  it("updateOverlay updates message text", async () => {
    const { elements } = createDom();
    const { showOverlay, updateOverlay } = await loadOverlay();
    showOverlay("Before");
    updateOverlay("After");
    const message = elements.find((el) => el.textContent === "After");
    expect(message).toBeTruthy();
  });

  it("showOverlay called twice reuses existing element", async () => {
    const { elements, body } = createDom();
    const { showOverlay } = await loadOverlay();
    showOverlay("First");
    const overlay = elements.find((el) => el.id === "mp-publisher-overlay");
    showOverlay("Second");
    const overlayInstances = elements.filter((el) => el.id === "mp-publisher-overlay");
    expect(overlayInstances).toHaveLength(1);
    expect(body.appendChild).toHaveBeenCalledTimes(1);
    expect(overlay.style.opacity).toBe("1");
  });
});
