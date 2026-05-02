import { defineStore } from "pinia";
import { ref } from "vue";
import {
  getArticles as fetchArticles,
  getArticle as fetchArticle,
  createArticle as apiCreate,
  updateArticle as apiUpdate,
  deleteArticle as apiDelete,
} from "../api/articles";

export const useArticlesStore = defineStore("articles", () => {
  const articles = ref([]);
  const currentArticle = ref(null);
  const loading = ref(false);

  async function loadArticles() {
    loading.value = true;
    try {
      const res = await fetchArticles(0, 100);
      articles.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function loadArticle(id) {
    loading.value = true;
    try {
      const res = await fetchArticle(id);
      currentArticle.value = res.data;
      return res.data;
    } finally {
      loading.value = false;
    }
  }

  async function createArticle(data) {
    const res = await apiCreate(data);
    articles.value.unshift(res.data);
    return res.data;
  }

  async function updateArticle(id, data) {
    const res = await apiUpdate(id, data);
    // F-4: Re-compute the index AFTER the await so we use the current array
    // state, not a stale index captured before a concurrent loadArticles()
    // replaced the entire articles.value array.
    const idx = articles.value.findIndex((a) => a.id === id);
    if (idx !== -1) articles.value[idx] = res.data;
    currentArticle.value = res.data;
    return res.data;
  }

  async function deleteArticle(id) {
    await apiDelete(id);
    articles.value = articles.value.filter((a) => a.id !== id);
  }

  return {
    articles,
    currentArticle,
    loading,
    loadArticles,
    loadArticle,
    createArticle,
    updateArticle,
    deleteArticle,
  };
});
