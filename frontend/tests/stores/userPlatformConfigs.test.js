import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useUserPlatformConfigsStore } from "../../src/stores/userPlatformConfigs";

vi.mock("../../src/api/userPlatformConfigs", () => ({
  listUserPlatformConfigs: vi.fn(),
  getUserPlatformConfig: vi.fn(),
  upsertUserPlatformConfig: vi.fn(),
  togglePlatformEnabled: vi.fn(),
}));

import {
  listUserPlatformConfigs,
  getUserPlatformConfig,
  upsertUserPlatformConfig,
  togglePlatformEnabled,
} from "../../src/api/userPlatformConfigs";

describe("userPlatformConfigs store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("initial state is empty", () => {
    const store = useUserPlatformConfigsStore();
    expect(store.configs).toEqual({});
    expect(store.enabled).toEqual({});
    expect(store.enabledSlugs).toEqual([]);
  });

  // --- loadAll ---

  it("loadAll populates configs and enabled from dict response", async () => {
    listUserPlatformConfigs.mockResolvedValue({
      success: true,
      data: {
        juejin: { platform_slug: "juejin", publish_config: { tags: ["test"] }, enabled: true },
        csdn: { platform_slug: "csdn", publish_config: { category: "backend" }, enabled: false },
      },
    });
    const store = useUserPlatformConfigsStore();

    await store.loadAll();
    expect(listUserPlatformConfigs).toHaveBeenCalled();
    expect(store.configs).toEqual({
      juejin: { tags: ["test"] },
      csdn: { category: "backend" },
    });
    expect(store.enabled).toEqual({ juejin: true, csdn: false });
    expect(store.enabledSlugs).toEqual(["juejin"]);
  });

  it("loadAll handles empty data", async () => {
    listUserPlatformConfigs.mockResolvedValue({ success: true, data: {} });
    const store = useUserPlatformConfigsStore();

    await store.loadAll();
    expect(store.configs).toEqual({});
    expect(store.enabled).toEqual({});
  });

  it("loadAll handles null data", async () => {
    listUserPlatformConfigs.mockResolvedValue({ success: true, data: null });
    const store = useUserPlatformConfigsStore();

    await store.loadAll();
    expect(store.configs).toEqual({});
    expect(store.enabled).toEqual({});
  });

  it("loadAll swallows errors and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    listUserPlatformConfigs.mockRejectedValue(new Error("fail"));
    const store = useUserPlatformConfigsStore();

    await store.loadAll();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // --- load (single) ---

  it("load fetches single config with enabled", async () => {
    getUserPlatformConfig.mockResolvedValue({
      success: true,
      data: { publish_config: { tags: ["test"] }, enabled: true },
    });
    const store = useUserPlatformConfigsStore();

    await store.load("juejin");
    expect(getUserPlatformConfig).toHaveBeenCalledWith("juejin");
    expect(store.configs).toEqual({ juejin: { tags: ["test"] } });
    expect(store.enabled).toEqual({ juejin: true });
  });

  it("load defaults enabled to false when missing", async () => {
    getUserPlatformConfig.mockResolvedValue({
      success: true,
      data: { publish_config: { tags: [] } },
    });
    const store = useUserPlatformConfigsStore();

    await store.load("csdn");
    expect(store.enabled).toEqual({ csdn: false });
  });

  it("load swallows errors and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getUserPlatformConfig.mockRejectedValue(new Error("network"));
    const store = useUserPlatformConfigsStore();

    await store.load("juejin");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // --- save ---

  it("save calls upsert and updates configs", async () => {
    upsertUserPlatformConfig.mockResolvedValue({ success: true });
    const store = useUserPlatformConfigsStore();

    await store.save("juejin", { tags: ["test"] });
    expect(upsertUserPlatformConfig).toHaveBeenCalledWith("juejin", { tags: ["test"] });
    expect(store.configs).toEqual({ juejin: { tags: ["test"] } });
  });

  // --- isEnabled ---

  it("isEnabled returns false for unknown slug", () => {
    const store = useUserPlatformConfigsStore();
    expect(store.isEnabled("unknown")).toBe(false);
  });

  it("isEnabled returns true for enabled slug", () => {
    const store = useUserPlatformConfigsStore();
    store.enabled = { juejin: true };
    expect(store.isEnabled("juejin")).toBe(true);
  });

  it("isEnabled returns false for disabled slug", () => {
    const store = useUserPlatformConfigsStore();
    store.enabled = { juejin: false };
    expect(store.isEnabled("juejin")).toBe(false);
  });

  // --- enabledSlugs ---

  it("enabledSlugs returns only true entries", () => {
    const store = useUserPlatformConfigsStore();
    store.enabled = { juejin: true, csdn: false, zhihu: true };
    expect(store.enabledSlugs).toEqual(expect.arrayContaining(["juejin", "zhihu"]));
    expect(store.enabledSlugs).toHaveLength(2);
  });

  // --- toggleEnabled ---

  it("toggleEnabled optimistically updates then confirms from API", async () => {
    togglePlatformEnabled.mockResolvedValue({
      success: true,
      data: { enabled: true },
    });
    const store = useUserPlatformConfigsStore();
    store.enabled = { juejin: false };

    await store.toggleEnabled("juejin");
    expect(togglePlatformEnabled).toHaveBeenCalledWith("juejin");
    expect(store.enabled.juejin).toBe(true);
  });

  it("toggleEnabled throws on API failure and does not change state", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    togglePlatformEnabled.mockRejectedValue(new Error("network"));
    const store = useUserPlatformConfigsStore();
    store.enabled = { juejin: true };

    await expect(store.toggleEnabled("juejin")).rejects.toThrow("network");
    // F-3: No optimistic update — original value preserved on failure
    expect(store.enabled.juejin).toBe(true);
    warnSpy.mockRestore();
  });

  it("toggleEnabled creates entry for unknown slug", async () => {
    togglePlatformEnabled.mockResolvedValue({
      success: true,
      data: { enabled: true },
    });
    const store = useUserPlatformConfigsStore();

    await store.toggleEnabled("newplatform");
    expect(store.enabled.newplatform).toBe(true);
  });

  it("toggleEnabled uses API response value, not just flip", async () => {
    // API might return a different value than expected
    togglePlatformEnabled.mockResolvedValue({
      success: true,
      data: { enabled: false },
    });
    const store = useUserPlatformConfigsStore();
    store.enabled = { juejin: true };

    await store.toggleEnabled("juejin");
    // Optimistic was false, but API returned false too, so stays false
    expect(store.enabled.juejin).toBe(false);
  });
});
