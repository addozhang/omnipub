import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import Settings from "../../src/views/Settings.vue";
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
import { listUserPlatformConfigs, togglePlatformEnabled } from "../../src/api/userPlatformConfigs";

const fakePlatforms = [
  { id: 1, name: "掘金", slug: "juejin", status: "active", new_article_url: "https://juejin.cn/editor" },
  { id: 2, name: "CSDN", slug: "csdn", status: "active", new_article_url: "https://csdn.net/editor" },
  { id: 3, name: "知乎", slug: "zhihu", status: "active", new_article_url: "https://zhuanlan.zhihu.com/write" },
];

describe("Settings.vue", () => {
  let openSpy;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    openSpy = vi.spyOn(window, "open").mockImplementation(() => {});

    getPlatforms.mockResolvedValue({ success: true, data: fakePlatforms });
    listUserPlatformConfigs.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  async function mountSettings() {
    const wrapper = mount(Settings, {
      global: {
        stubs: {
          PlatformConfigModal: true,
          RouterLink: true,
        },
      },
    });
    await flushPromises();
    return wrapper;
  }

  it("clicking platform card checkbox triggers toggleEnabled", async () => {
    togglePlatformEnabled.mockResolvedValue({ success: true, data: { enabled: true } });

    const wrapper = await mountSettings();
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    // +1 for the "全选/取消全选" checkbox
    expect(checkboxes.length).toBe(fakePlatforms.length + 1);

    // checkboxes[0] is "全选", platform checkboxes start at index 1
    await checkboxes[1].setValue(true);

    const upcStore = useUserPlatformConfigsStore();
    expect(togglePlatformEnabled).toHaveBeenCalledWith("juejin");
  });

  it("checkLoginStatus only checks enabled platforms", async () => {
    // Enable only 掘金
    const wrapper = await mountSettings();
    const upcStore = useUserPlatformConfigsStore();
    upcStore.enabled = { juejin: true, csdn: false, zhihu: false };
    await flushPromises();

    // Set up event listener to capture dispatched event
    let capturedDetail = null;
    const handler = (e) => {
      capturedDetail = e.detail;
      // Respond with login check result to prevent timeout
      window.dispatchEvent(
        new CustomEvent("omnipub:check-login-result", {
          detail: { results: [{ slug: "juejin", name: "掘金", loggedIn: true }] },
        })
      );
    };
    window.addEventListener("omnipub:check-login", handler);

    // Click the check login status button
    const checkBtn = wrapper.find("button");
    await checkBtn.trigger("click");
    await flushPromises();

    expect(capturedDetail).not.toBeNull();
    expect(capturedDetail.platforms).toHaveLength(1);
    expect(capturedDetail.platforms[0].slug).toBe("juejin");

    window.removeEventListener("omnipub:check-login", handler);
  });

  it("shows error message when no platforms are enabled and check login is clicked", async () => {
    const wrapper = await mountSettings();
    const upcStore = useUserPlatformConfigsStore();
    upcStore.enabled = {};
    await flushPromises();

    // Click the check login status button
    const checkBtn = wrapper.find("button");
    await checkBtn.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("请先启用至少一个平台");
  });
});
