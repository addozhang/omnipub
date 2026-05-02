import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ArticleCard from "../../src/components/ArticleCard.vue";

const fakeArticle = {
  id: 1,
  title: "Test Article",
  created_at: "2024-01-15T10:00:00Z",
};

const mountCard = (props = {}) =>
  mount(ArticleCard, {
    props: { article: fakeArticle, ...props },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });

describe("ArticleCard", () => {
  it("renders article title", () => {
    const wrapper = mountCard();
    expect(wrapper.text()).toContain("Test Article");
  });

  it("renders edit and publish links", () => {
    const wrapper = mountCard();
    expect(wrapper.text()).toContain("编辑");
    expect(wrapper.text()).toContain("分发");
  });

  it("emits delete event with article id on delete button click", async () => {
    const wrapper = mountCard();
    const deleteBtn = wrapper.find('button[title="删除文章"]');
    await deleteBtn.trigger("click");
    expect(wrapper.emitted("delete")).toEqual([[fakeArticle.id]]);
  });

  it("formatDate displays formatted date", () => {
    const wrapper = mountCard();
    const text = wrapper.text();
    expect(text).toMatch(/2024/);
  });
});
