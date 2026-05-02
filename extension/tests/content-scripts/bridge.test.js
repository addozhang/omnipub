import { beforeEach, describe, expect, it, vi } from "vitest";

const loadBridge = async () => {
  await import("../../content-scripts/common/bridge.js");
  return window.MessageBridge;
};

describe("MessageBridge", () => {
  beforeEach(() => {
    vi.resetModules();
    global.window = {
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    };
    chrome.runtime.sendMessage = vi.fn();
    chrome.runtime.lastError = undefined;
  });

  it("sendToBackground calls chrome.runtime.sendMessage and resolves", async () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      callback({ ok: true });
    });
    const bridge = await loadBridge();
    await expect(bridge.sendToBackground({ action: "ping" })).resolves.toEqual({ ok: true });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: "ping" }, expect.any(Function));
  });

  it("sendToBackground rejects on runtime lastError", async () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      chrome.runtime.lastError = { message: "boom" };
      callback(undefined);
    });
    const bridge = await loadBridge();
    await expect(bridge.sendToBackground({ action: "fail" })).rejects.toThrow("boom");
  });

  it("getSession returns token data on success", async () => {
    const bridge = await loadBridge();
    vi.spyOn(bridge, "sendToBackground").mockResolvedValue({ success: true, data: "token-1" });
    await expect(bridge.getSession()).resolves.toBe("token-1");
  });

  it("reportPublishResult sends message with action and data", async () => {
    const bridge = await loadBridge();
    const spy = vi.spyOn(bridge, "sendToBackground").mockResolvedValue({ success: true });
    const payload = { publication_id: 1, status: "published" };
    await bridge.reportPublishResult(payload);
    expect(spy).toHaveBeenCalledWith({ action: "reportPublishResult", data: payload });
  });

  it("onPageMessage handles matching postMessage only", async () => {
    const bridge = await loadBridge();
    const handler = vi.fn();
    bridge.onPageMessage("mp-test", handler);
    const listener = window.addEventListener.mock.calls[0][1];
    listener({ source: {}, data: { type: "mp-test" } });
    listener({ source: window, data: { type: "other" } });
    listener({ source: window, data: { type: "mp-test", value: 1 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: "mp-test", value: 1 });
  });

  it("onRuntimeMessage dispatches matching action", async () => {
    const bridge = await loadBridge();
    const handler = vi.fn(() => ({ success: true }));
    bridge.onRuntimeMessage("do", handler);
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = vi.fn();
    const result = listener({ action: "do" }, { tab: 1 }, sendResponse);
    expect(handler).toHaveBeenCalledWith({ action: "do" }, { tab: 1 });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(result).toBe(false);
  });
});
