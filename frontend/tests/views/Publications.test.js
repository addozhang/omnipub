import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../../src/api/articles", () => ({
  getArticles: vi.fn(),
}));

vi.mock("../../src/api/publications", () => ({
  getPublicationsBatch: vi.fn(),
}));

vi.mock("../../src/api/platforms", () => ({
  getPlatforms: vi.fn(),
}));

import { getArticles } from "../../src/api/articles";
import { getPublicationsBatch } from "../../src/api/publications";
import { getPlatforms } from "../../src/api/platforms";
import Publications from "../../src/views/Publications.vue";

const fakeArticles = [
  { id: 1, title: "Vue 实战指南" },
  { id: 2, title: "TypeScript 最佳实践" },
];

const fakePlatforms = [
  { id: 1, name: "掘金", slug: "juejin", new_article_url: "https://juejin.cn/editor", icon_url: null },
  { id: 2, name: "CSDN", slug: "csdn", new_article_url: "https://csdn.net/editor", icon_url: null },
];

const fakeBatch = {
  "1": [
    {
      id: 1,
      platform_slug: "juejin",
      platform_name: "掘金",
      platform_icon_url: null,
      article_url: "https://juejin.cn/post/1",
      created_at: "2024-01-15T10:00:00Z",
      latest_stats: { view_count: 100 },
    },
    {
      id: 2,
      platform_slug: "csdn",
      platform_name: "CSDN",
      platform_icon_url: null,
      article_url: "https://csdn.net/1",
      created_at: "2024-01-14T10:00:00Z",
      latest_stats: { view_count: 50 },
    },
  ],
};

function makeManyPubs(count) {
  const batch = {};
  for (let i = 1; i <= count; i++) {
    batch[String(i)] = [
      {
        id: i,
        platform_slug: "juejin",
        platform_name: "掘金",
        platform_icon_url: null,
        article_url: `https://juejin.cn/post/${i}`,
        created_at: `2024-01-${String(i).padStart(2, "0")}T10:00:00Z`,
        latest_stats: { view_count: i * 10 },
      },
    ];
  }
  return batch;
}

function makeManyArticles(count) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, title: `Article ${i + 1}` }));
}

describe("Publications.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    getPlatforms.mockResolvedValue({ success: true, data: fakePlatforms });
  });

  async function mountPublications() {
    const wrapper = mount(Publications, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });
    return wrapper;
  }

  it("shows loading state initially", async () => {
    getArticles.mockReturnValue(new Promise(() => {}));
    getPublicationsBatch.mockReturnValue(new Promise(() => {}));

    const wrapper = await mountPublications();

    expect(wrapper.text()).toContain("加载中...");
  });

  it("renders publication records table after load", async () => {
    getArticles.mockResolvedValue({ success: true, data: fakeArticles });
    getPublicationsBatch.mockResolvedValue({ success: true, data: fakeBatch });

    const wrapper = await mountPublications();
    await flushPromises();

    expect(wrapper.find("table").exists()).toBe(true);
    const rows = wrapper.findAll("tbody tr");
    expect(rows.length).toBe(2);
    expect(wrapper.text()).toContain("https://juejin.cn/post/1");
  });

  it("shows empty state when no records", async () => {
    getArticles.mockResolvedValue({ success: true, data: [] });
    getPublicationsBatch.mockResolvedValue({ success: true, data: {} });

    const wrapper = await mountPublications();
    await flushPromises();

    expect(wrapper.text()).toContain("暂无发布记录");
  });

  it("filter by platform narrows filteredRecords", async () => {
    getArticles.mockResolvedValue({ success: true, data: fakeArticles });
    getPublicationsBatch.mockResolvedValue({ success: true, data: fakeBatch });

    const wrapper = await mountPublications();
    await flushPromises();

    const select = wrapper.find("select");
    await select.setValue("csdn");

    const rows = wrapper.findAll("tbody tr");
    expect(rows.length).toBe(1);
  });

  it("pagination appears for 15+ records and next/prev works", async () => {
    const articles = makeManyArticles(15);
    const batch = makeManyPubs(15);

    getArticles.mockResolvedValue({ success: true, data: articles });
    getPublicationsBatch.mockResolvedValue({ success: true, data: batch });

    const wrapper = await mountPublications();
    await flushPromises();

    expect(wrapper.text()).toContain("下一页");
    expect(wrapper.text()).toContain("上一页");

    const rows = wrapper.findAll("tbody tr");
    expect(rows.length).toBe(10);

    const nextBtn = wrapper.findAll("button").find((b) => b.text() === "下一页");
    await nextBtn.trigger("click");
    await flushPromises();

    const rowsPage2 = wrapper.findAll("tbody tr");
    expect(rowsPage2.length).toBe(5);
  });

  it("visiblePages shows dots for large page counts", async () => {
    const articles = makeManyArticles(100);
    const batch = makeManyPubs(100);

    getArticles.mockResolvedValue({ success: true, data: articles });
    getPublicationsBatch.mockResolvedValue({ success: true, data: batch });

    const wrapper = await mountPublications();
    await flushPromises();

    expect(wrapper.text()).toContain("...");
  });
});
