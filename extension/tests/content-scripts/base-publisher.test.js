import { beforeEach, describe, expect, it, vi } from "vitest";

const loadBasePublisher = async () => {
  await import("../../content-scripts/common/base-publisher.js");
  return window.BasePublisher;
};

describe("base-publisher utilities", () => {
  beforeEach(() => {
    vi.resetModules();
    global.window = { name: "" };
    global.document = {
      querySelector: vi.fn(),
      querySelectorAll: vi.fn(() => []),
    };
    global.Event = class Event {};
    global.InputEvent = global.Event;
    global.HTMLInputElement = function () {};
    global.HTMLTextAreaElement = function () {};
    global.atob = (value) => Buffer.from(value, "base64").toString("binary");
    global.btoa = (value) => Buffer.from(value, "binary").toString("base64");
    chrome.runtime.sendMessage = vi.fn();
    chrome.runtime.onMessage.addListener = vi.fn();
  });

  it("fetchConfig normalizes title_selector to title_selectors", async () => {
    const BasePublisher = await loadBasePublisher();
    globalThis.PLATFORM_CONFIGS = [
      { slug: "juejin", name: "掘金", editor: { title_selector: "#title" } },
    ];
    const publisher = new BasePublisher("juejin");
    const config = await publisher.fetchConfig();
    expect(config.editor_config.title_selectors).toEqual(["#title"]);
  });

  it("fetchConfig normalizes content_selector to content_selectors", async () => {
    const BasePublisher = await loadBasePublisher();
    globalThis.PLATFORM_CONFIGS = [
      { slug: "juejin", name: "掘金", editor: { content_selector: ".editor" } },
    ];
    const publisher = new BasePublisher("juejin");
    const config = await publisher.fetchConfig();
    expect(config.editor_config.content_selectors).toEqual([".editor"]);
  });

  it("fetchConfig splits comma-separated selectors", async () => {
    const BasePublisher = await loadBasePublisher();
    globalThis.PLATFORM_CONFIGS = [
      { slug: "juejin", name: "掘金", editor: { title_selector: "#a, .b" } },
    ];
    const publisher = new BasePublisher("juejin");
    const config = await publisher.fetchConfig();
    expect(config.editor_config.title_selectors).toEqual(["#a", ".b"]);
  });

  it("fetchConfig returns config even when editor is empty", async () => {
    const BasePublisher = await loadBasePublisher();
    globalThis.PLATFORM_CONFIGS = [
      { slug: "juejin", name: "掘金", editor: {} },
    ];
    const publisher = new BasePublisher("juejin");
    const config = await publisher.fetchConfig();
    expect(config.editor_config).toBeTruthy();
  });

  it("fetchConfig preserves existing title_selectors", async () => {
    const BasePublisher = await loadBasePublisher();
    globalThis.PLATFORM_CONFIGS = [
      { slug: "juejin", name: "掘金", editor: { title_selectors: [".keep"], title_selector: "#drop" } },
    ];
    const publisher = new BasePublisher("juejin");
    const config = await publisher.fetchConfig();
    expect(config.editor_config.title_selectors).toEqual([".keep"]);
  });
});

describe("BasePublisher", () => {
  beforeEach(() => {
    vi.resetModules();
    global.window = { name: "", __omnipubPublisher: null };
    global.document = {
      querySelector: vi.fn(),
      querySelectorAll: vi.fn(() => []),
    };
    global.Event = class Event {};
    global.InputEvent = global.Event;
    global.HTMLInputElement = function () {};
    global.HTMLTextAreaElement = function () {};
    global.atob = (value) => Buffer.from(value, "base64").toString("binary");
    global.btoa = (value) => Buffer.from(value, "binary").toString("base64");
    chrome.runtime.sendMessage = vi.fn();
    chrome.runtime.onMessage.addListener = vi.fn();
  });

  it("constructor sets platform and initializes state", async () => {
    const BasePublisher = await loadBasePublisher();
    const publisher = new BasePublisher("juejin");
    expect(publisher.platform).toBe("juejin");
    expect(publisher.config).toBeNull();
    expect(publisher.articleData).toBeNull();
    expect(publisher.fillTriggered).toBe(false);
  });

  it("init registers publisher globally and fetches config", async () => {
    const BasePublisher = await loadBasePublisher();
    globalThis.PLATFORM_CONFIGS = [
      { slug: "juejin", name: "掘金", editor: { title_selector: "#title" } },
    ];
    const publisher = new BasePublisher("juejin");
    await publisher.init();
    expect(window.__omnipubPublisher).toBe(publisher);
    expect(publisher.config).toBeTruthy();
    expect(publisher.config.name).toBe("掘金");
  });

  it("init does not set articleData (waits for FILL_AND_PUBLISH)", async () => {
    const BasePublisher = await loadBasePublisher();
    globalThis.PLATFORM_CONFIGS = [
      { slug: "juejin", name: "掘金", editor: { title_selector: "#title" } },
    ];
    const publisher = new BasePublisher("juejin");
    await publisher.init();
    expect(publisher.articleData).toBeNull();
  });
});
