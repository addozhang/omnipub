import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("useExtension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("compareVersions equality yields installed status", async () => {
    vi.resetModules();
    const raw = await import("../../src/composables/useExtension.js?raw");
    const source = raw.default;
    const start = source.indexOf("function compareVersions");
    expect(start).toBeGreaterThan(-1);
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    let body = "";
    for (let i = braceStart; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          body = source.slice(braceStart + 1, i);
          break;
        }
      }
    }
    expect(body).not.toBe("");
    const compareVersions = new Function("a", "b", body);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("compareVersions a < b yields outdated status", async () => {
    vi.resetModules();
    const raw = await import("../../src/composables/useExtension.js?raw");
    const source = raw.default;
    const start = source.indexOf("function compareVersions");
    expect(start).toBeGreaterThan(-1);
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    let body = "";
    for (let i = braceStart; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          body = source.slice(braceStart + 1, i);
          break;
        }
      }
    }
    expect(body).not.toBe("");
    const compareVersions = new Function("a", "b", body);
    expect(compareVersions("1.2.3", "1.3.0")).toBe(-1);
  });

  it("compareVersions a > b yields installed status", async () => {
    vi.resetModules();
    const raw = await import("../../src/composables/useExtension.js?raw");
    const source = raw.default;
    const start = source.indexOf("function compareVersions");
    expect(start).toBeGreaterThan(-1);
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    let body = "";
    for (let i = braceStart; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          body = source.slice(braceStart + 1, i);
          break;
        }
      }
    }
    expect(body).not.toBe("");
    const compareVersions = new Function("a", "b", body);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("fetchLatestVersion returns version from API response", async () => {
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { version: "1.2.3" } }),
    });

    const { useExtension } = await import("../../src/composables/useExtension");
    const { check, latestVersion } = useExtension();

    const promise = check();
    await vi.runAllTimersAsync();
    await promise;

    expect(global.fetch).toHaveBeenCalledWith("/api/extension/version");
    expect(latestVersion.value).toBe("1.2.3");
  });

  it("fetchLatestVersion returns null on fetch error", async () => {
    vi.resetModules();
    global.fetch = vi.fn().mockRejectedValue(new Error("boom"));
    const { useExtension } = await import("../../src/composables/useExtension");
    const { check, latestVersion } = useExtension();

    const promise = check();
    await vi.runAllTimersAsync();
    await promise;

    expect(latestVersion.value).toBe(null);
  });

  it("check sets status to not-installed when no ready event", async () => {
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { version: "1.0.0" } }),
    });
    const { useExtension } = await import("../../src/composables/useExtension");
    const { check, status } = useExtension();

    const promise = check();
    await vi.runAllTimersAsync();
    await promise;

    expect(status.value).toBe("not-installed");
  });

  it("check sets status to installed when versions match", async () => {
    vi.resetModules();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { version: "1.0.0" } }),
    });

    const { useExtension } = await import("../../src/composables/useExtension");
    const { check, status, installedVersion } = useExtension();

    const promise = check();
    await vi.advanceTimersByTimeAsync(100);

    window.dispatchEvent(
      new CustomEvent("omnipub:ready", { detail: { version: "1.0.0" } })
    );
    await promise;

    expect(installedVersion.value).toBe("1.0.0");
    expect(status.value).toBe("installed");
  });

  it("check sets status to outdated when installed version is older", async () => {
    vi.resetModules();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { version: "2.0.0" } }),
    });

    const { useExtension } = await import("../../src/composables/useExtension");
    const { check, status } = useExtension();

    const promise = check();
    await vi.advanceTimersByTimeAsync(100);

    window.dispatchEvent(
      new CustomEvent("omnipub:ready", { detail: { version: "1.0.0" } })
    );
    await promise;

    expect(status.value).toBe("outdated");
  });

  it("useExtension triggers check only on first call", async () => {
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { version: "1.0.0" } }),
    });

    const { useExtension } = await import("../../src/composables/useExtension");
    const first = useExtension();
    const second = useExtension();

    expect(first.status).toBe(second.status);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
