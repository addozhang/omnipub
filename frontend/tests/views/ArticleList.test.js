import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../../src/api/articles", () => ({
  getArticles: vi.fn(),
  deleteArticle: vi.fn(),
}));

import { getArticles, deleteArticle } from "../../src/api/articles";
import ArticleList from "../../src/views/ArticleList.vue";
import { useArticlesStore } from "../../src/stores/articles";

const fakeArticles = [
  { id: 1, title: "文章一", markdown_content: "内容一", created_at: "2026-01-01" },
  { id: 2, title: "文章二", markdown_content: "内容二", created_at: "2026-01-02" },
];

describe("ArticleList.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function mountArticleList() {
    return mount(ArticleList, {
      global: {
        stubs: {
          ArticleCard: {
            name: "ArticleCard",
            template: '<div class="article-card-stub" @click="$emit(\'delete\', article.id)"></div>',
            props: ["article"],
            emits: ["delete"],
          },
          RouterLink: true,
        },
      },
    });
  }

  it("shows loading state initially", async () => {
    getArticles.mockImplementation(() => new Promise(() => {}));
    const wrapper = mountArticleList();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("加载中...");
  });

  it("renders article list after load", async () => {
    getArticles.mockResolvedValue({ data: fakeArticles });

    const wrapper = mountArticleList();
    await flushPromises();

    const cards = wrapper.findAll(".article-card-stub");
    expect(cards.length).toBe(2);
  });

  it("shows empty state when no articles", async () => {
    getArticles.mockResolvedValue({ data: [] });

    const wrapper = mountArticleList();
    await flushPromises();

    expect(wrapper.text()).toContain("还没有文章");
  });

  it("shows error state on load failure", async () => {
    getArticles.mockRejectedValue(new Error("网络错误"));

    const wrapper = mountArticleList();
    await flushPromises();

    expect(wrapper.text()).toContain("加载失败");
    expect(wrapper.find("button").text()).toBe("重试");
  });

  it("retry button calls loadData again", async () => {
    getArticles
      .mockRejectedValueOnce(new Error("网络错误"))
      .mockResolvedValue({ data: [] });

    const wrapper = mountArticleList();
    await flushPromises();

    expect(wrapper.text()).toContain("加载失败");

    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(getArticles).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("还没有文章");
  });

  it("delete flow: shows dialog and confirms deletes article", async () => {
    getArticles.mockResolvedValue({ data: fakeArticles });
    deleteArticle.mockResolvedValue({});

    const wrapper = mountArticleList();
    await flushPromises();

    await wrapper.vm.handleDelete(1);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("确认删除");

    const confirmBtn = wrapper.findAll("button").find((b) => b.text() === "删除");
    await confirmBtn.trigger("click");
    await flushPromises();

    expect(deleteArticle).toHaveBeenCalledWith(1);
  });
});
