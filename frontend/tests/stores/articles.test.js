import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useArticlesStore } from "../../src/stores/articles";

vi.mock("../../src/api/articles", () => ({
  getArticles: vi.fn(),
  getArticle: vi.fn(),
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  deleteArticle: vi.fn(),
}));

import {
  getArticles,
  getArticle,
  createArticle,
  updateArticle,
  deleteArticle,
} from "../../src/api/articles";

describe("articles store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("initial state", () => {
    const store = useArticlesStore();
    expect(store.articles).toEqual([]);
    expect(store.currentArticle).toBe(null);
    expect(store.loading).toBe(false);
  });

  it("loadArticles fetches and sets articles and loading", async () => {
    getArticles.mockResolvedValue({
      success: true,
      data: [{ id: 1, title: "Art1" }, { id: 2, title: "Art2" }],
    });
    const store = useArticlesStore();

    const promise = store.loadArticles();
    expect(store.loading).toBe(true);
    await promise;

    expect(getArticles).toHaveBeenCalledWith(0, 100);
    expect(store.articles).toEqual([
      { id: 1, title: "Art1" },
      { id: 2, title: "Art2" },
    ]);
    expect(store.loading).toBe(false);
  });

  it("loadArticles sets loading false on error", async () => {
    getArticles.mockRejectedValue(new Error("fail"));
    const store = useArticlesStore();

    await expect(store.loadArticles()).rejects.toThrow("fail");
    expect(store.loading).toBe(false);
  });

  it("loadArticle fetches single article", async () => {
    getArticle.mockResolvedValue({
      success: true,
      data: { id: 1, title: "Art1" },
    });
    const store = useArticlesStore();

    const result = await store.loadArticle(1);
    expect(getArticle).toHaveBeenCalledWith(1);
    expect(store.currentArticle).toEqual({ id: 1, title: "Art1" });
    expect(result).toEqual({ id: 1, title: "Art1" });
  });

  it("createArticle unshifts new article", async () => {
    createArticle.mockResolvedValue({
      success: true,
      data: { id: 3, title: "New" },
    });
    const store = useArticlesStore();
    store.articles = [{ id: 1, title: "Art1" }];

    const result = await store.createArticle({ title: "New" });
    expect(createArticle).toHaveBeenCalledWith({ title: "New" });
    expect(store.articles[0]).toEqual({ id: 3, title: "New" });
    expect(result).toEqual({ id: 3, title: "New" });
  });

  it("updateArticle updates list item and currentArticle", async () => {
    updateArticle.mockResolvedValue({
      success: true,
      data: { id: 1, title: "Updated" },
    });
    const store = useArticlesStore();
    store.articles = [{ id: 1, title: "Old" }];

    const result = await store.updateArticle(1, { title: "Updated" });
    expect(updateArticle).toHaveBeenCalledWith(1, { title: "Updated" });
    expect(store.articles[0]).toEqual({ id: 1, title: "Updated" });
    expect(store.currentArticle).toEqual({ id: 1, title: "Updated" });
    expect(result).toEqual({ id: 1, title: "Updated" });
  });

  it("updateArticle handles missing article in list", async () => {
    updateArticle.mockResolvedValue({
      success: true,
      data: { id: 2, title: "Updated" },
    });
    const store = useArticlesStore();
    store.articles = [{ id: 1, title: "Old" }];

    await store.updateArticle(2, { title: "Updated" });
    expect(store.articles).toEqual([{ id: 1, title: "Old" }]);
    expect(store.currentArticle).toEqual({ id: 2, title: "Updated" });
  });

  it("deleteArticle removes article", async () => {
    deleteArticle.mockResolvedValue({ success: true });
    const store = useArticlesStore();
    store.articles = [
      { id: 1, title: "Art1" },
      { id: 2, title: "Art2" },
    ];

    await store.deleteArticle(1);
    expect(deleteArticle).toHaveBeenCalledWith(1);
    expect(store.articles).toEqual([{ id: 2, title: "Art2" }]);
  });
});
