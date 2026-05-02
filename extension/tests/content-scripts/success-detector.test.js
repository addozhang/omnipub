import { beforeEach, describe, expect, it, vi } from "vitest";

const loadDetector = async () => {
  await import("../../content-scripts/success-detector.js");
  return window.SuccessDetector;
};

describe("SuccessDetector", () => {
  beforeEach(() => {
    vi.resetModules();
    global.window = {
      location: { href: "https://example.com/editor" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      opener: null,
    };
    global.document = { body: {} };
    global.history = {
      pushState: vi.fn(),
      replaceState: vi.fn(),
    };
    global.MutationObserver = vi.fn(function (callback) {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      this.__callback = callback;
    });
    chrome.runtime.sendMessage = vi.fn();
  });

  it("constructor sets config and builds urlPattern", async () => {
    const SuccessDetector = await loadDetector();
    const detector = new SuccessDetector("juejin", {
      article_url_pattern: "https://example.com/post/{article_id}",
      publicationId: 2,
    });
    expect(detector.platform).toBe("juejin");
    expect(detector.urlPattern).toBeInstanceOf(RegExp);
    expect(detector.publicationId).toBe(2);
  });

  it("_buildUrlPattern converts pattern with {article_id}", async () => {
    const SuccessDetector = await loadDetector();
    const detector = new SuccessDetector("x", { article_url_pattern: "" });
    const regex = detector._buildUrlPattern("https://a.com/post/{article_id}");
    expect("https://a.com/post/abc-1".match(regex)).toBeTruthy();
  });

  it("_buildUrlPattern returns null for empty pattern", async () => {
    const SuccessDetector = await loadDetector();
    const detector = new SuccessDetector("x", { article_url_pattern: "" });
    expect(detector._buildUrlPattern("")).toBeNull();
  });

  it("_checkUrl matches URL and calls _onSuccess", async () => {
    const SuccessDetector = await loadDetector();
    const detector = new SuccessDetector("x", {
      article_url_pattern: "https://example.com/post/{article_id}",
    });
    const spy = vi.spyOn(detector, "_onSuccess").mockResolvedValue();
    detector._checkUrl("https://example.com/post/abc123");
    expect(spy).toHaveBeenCalledWith("https://example.com/post/abc123", "abc123");
  });

  it("start sets running state and timers/observers", async () => {
    vi.useFakeTimers();
    const SuccessDetector = await loadDetector();
    const detector = new SuccessDetector("x", {
      article_url_pattern: "https://example.com/post/{article_id}",
    });
    detector.start();
    expect(detector.isRunning).toBe(true);
    expect(detector.pollTimer).not.toBeNull();
    expect(detector.timeoutTimer).not.toBeNull();
    expect(detector.mutationObserver.observe).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stop clears timers and observers", async () => {
    vi.useFakeTimers();
    const SuccessDetector = await loadDetector();
    const detector = new SuccessDetector("x", {
      article_url_pattern: "https://example.com/post/{article_id}",
    });
    detector.start();
    detector.stop();
    expect(detector.isRunning).toBe(false);
    expect(detector.pollTimer).toBeNull();
    expect(detector.timeoutTimer).toBeNull();
    expect(detector.mutationObserver).toBeNull();
    vi.useRealTimers();
  });

  it("_onSuccess marks detected, stops, and reports progress", async () => {
    const SuccessDetector = await loadDetector();
    const detector = new SuccessDetector("juejin", {
      article_url_pattern: "https://example.com/post/{article_id}",
      publicationId: 5,
    });
    vi.spyOn(detector, "stop").mockImplementation(() => {
      detector.isRunning = false;
    });
    await detector._onSuccess("https://example.com/post/1", "1");
    expect(detector.detected).toBe(true);
    expect(detector.stop).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: "publishProgress",
      progress: {
        platform: "juejin",
        status: "success",
        message: "发布成功",
        article_url: "https://example.com/post/1",
      },
    });
  });
});
