import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { usePlatformsStore } from "../../src/stores/platforms";
import { useUserPlatformConfigsStore } from "../../src/stores/userPlatformConfigs";

vi.mock("../../src/api/platforms", () => ({
  getPlatforms: vi.fn(),
}));

vi.mock("../../src/api/userPlatformConfigs", () => ({
  listUserPlatformConfigs: vi.fn(),
  getUserPlatformConfig: vi.fn(),
  upsertUserPlatformConfig: vi.fn(),
  togglePlatformEnabled: vi.fn(),
}));

import { getPlatforms } from "../../src/api/platforms";

const platformResponse = {
  success: true,
  data: [
    { id: 1, name: "掘金", slug: "juejin" },
    { id: 2, name: "CSDN", slug: "csdn" },
  ],
};

describe("platforms store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("loadPlatforms fetches and sets platforms and loading", async () => {
    getPlatforms.mockResolvedValue(platformResponse);
    const store = usePlatformsStore();
    const promise = store.loadPlatforms();
    expect(store.loading).toBe(true);
    await promise;

    expect(getPlatforms).toHaveBeenCalled();
    expect(store.platforms).toEqual(platformResponse.data);
    expect(store.loading).toBe(false);
  });

  it("selectedPlatforms returns only enabled platforms", () => {
    const store = usePlatformsStore();
    store.platforms = platformResponse.data;

    const upcStore = useUserPlatformConfigsStore();
    upcStore.enabled = { csdn: true };

    expect(store.selectedPlatforms).toEqual([
      { id: 2, name: "CSDN", slug: "csdn" },
    ]);
  });

  it("selectedPlatforms returns empty when nothing enabled", () => {
    const store = usePlatformsStore();
    store.platforms = platformResponse.data;

    const upcStore = useUserPlatformConfigsStore();
    upcStore.enabled = {};

    expect(store.selectedPlatforms).toEqual([]);
  });

  it("selectedPlatforms returns all when all enabled", () => {
    const store = usePlatformsStore();
    store.platforms = platformResponse.data;

    const upcStore = useUserPlatformConfigsStore();
    upcStore.enabled = { juejin: true, csdn: true };

    expect(store.selectedPlatforms).toEqual(platformResponse.data);
  });

  it("selectedPlatforms ignores slugs not in platforms list", () => {
    const store = usePlatformsStore();
    store.platforms = platformResponse.data;

    const upcStore = useUserPlatformConfigsStore();
    upcStore.enabled = { juejin: true, nonexistent: true };

    expect(store.selectedPlatforms).toEqual([
      { id: 1, name: "掘金", slug: "juejin" },
    ]);
  });

  it("selectedPlatforms skips platforms with enabled=false", () => {
    const store = usePlatformsStore();
    store.platforms = platformResponse.data;

    const upcStore = useUserPlatformConfigsStore();
    upcStore.enabled = { juejin: true, csdn: false };

    expect(store.selectedPlatforms).toEqual([
      { id: 1, name: "掘金", slug: "juejin" },
    ]);
  });
});
