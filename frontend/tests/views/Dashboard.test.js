import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../../src/api/articles", () => ({
  getArticles: vi.fn(),
}));

vi.mock("../../src/api/platforms", () => ({
  getPlatforms: vi.fn(),
}));

vi.mock("../../src/api/publications", () => ({
  getPublicationsBatch: vi.fn(),
}));

import { getArticles } from "../../src/api/articles";
import { getPlatforms } from "../../src/api/platforms";
import { getPublicationsBatch } from "../../src/api/publications";
import Dashboard from "../../src/views/Dashboard.vue";

const fakeArticles = [
  { id: 1, title: "Article 1" },
  { id: 2, title: "Article 2" },
];

const fakePlatforms = [
  { id: 1, name: "掘金", slug: "juejin", new_article_url: "https://juejin.cn/editor", icon_url: null },
  { id: 2, name: "CSDN", slug: "csdn", new_article_url: "https://csdn.net/editor", icon_url: null },
];

const fakeBatchPubs = {
  "1": [
    { id: 10, platform_id: 1, platform_slug: "juejin", latest_stats: { view_count: 100 } },
    { id: 11, platform_id: 2, platform_slug: "csdn", latest_stats: { view_count: 50 } },
  ],
  "2": [
    { id: 12, platform_id: 1, platform_slug: "juejin", latest_stats: { view_count: 200 } },
  ],
};

describe("Dashboard.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  async function mountDashboard() {
    const wrapper = mount(Dashboard, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });
    await flushPromises();
    return wrapper;
  }

  it("renders hero banner with stats after load", async () => {
    getArticles.mockResolvedValue({ success: true, data: fakeArticles });
    getPlatforms.mockResolvedValue({ success: true, data: fakePlatforms });
    getPublicationsBatch.mockResolvedValue({ success: true, data: fakeBatchPubs });

    const wrapper = await mountDashboard();

    // 总文章数 = 2
    expect(wrapper.text()).toContain("总文章数");
    expect(wrapper.text()).toContain("发布次数");
    expect(wrapper.text()).toContain("2");
    expect(wrapper.text()).toContain("3");
  });

  it("shows error state on API failure", async () => {
    getArticles.mockRejectedValue(new Error("网络错误"));
    getPlatforms.mockResolvedValue({ success: true, data: fakePlatforms });
    getPublicationsBatch.mockResolvedValue({ success: true, data: {} });

    const wrapper = await mountDashboard();

    expect(wrapper.text()).toContain("网络错误");
    expect(wrapper.text()).toContain("重新加载");
  });

  it("shows empty platform stats when no platforms exist", async () => {
    getArticles.mockResolvedValue({ success: true, data: fakeArticles });
    getPlatforms.mockResolvedValue({ success: true, data: [] });
    getPublicationsBatch.mockResolvedValue({ success: true, data: {} });

    const wrapper = await mountDashboard();

    expect(wrapper.text()).toContain("暂无发布数据");
  });

  it("renders platform stats cards with platform names", async () => {
    getArticles.mockResolvedValue({ success: true, data: fakeArticles });
    getPlatforms.mockResolvedValue({ success: true, data: fakePlatforms });
    getPublicationsBatch.mockResolvedValue({ success: true, data: fakeBatchPubs });

    const wrapper = await mountDashboard();

    expect(wrapper.text()).toContain("掘金");
    expect(wrapper.text()).toContain("CSDN");
    expect(wrapper.text()).toContain("各平台发布统计");
  });
});
