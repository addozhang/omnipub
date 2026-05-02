<template>
  <div>
    <!-- Header -->
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="flex items-center gap-4">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          我的文章
        </h1>
        
        <!-- Total count card -->
        <div v-if="!articlesStore.loading" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg dark:bg-gray-800/60 dark:border-gray-700">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500 dark:text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
          </svg>
          <span class="text-sm font-medium text-gray-600 dark:text-gray-300">
            {{ articlesStore.articles.length }} <span class="font-normal text-gray-500 dark:text-gray-400">总文章数</span>
          </span>
        </div>
      </div>

      <router-link
        to="/articles/new"
        class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600 shadow-sm shrink-0"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
        </svg>
        写新文章
      </router-link>
    </div>

    <!-- 加载中 -->
    <div
      v-if="articlesStore.loading"
      class="py-20 text-center text-gray-400"
    >
      加载中...
    </div>

    <!-- 加载失败 -->
    <div
      v-else-if="loadError"
      class="py-20 text-center"
    >
      <p class="text-lg text-red-500">加载失败</p>
      <p class="mt-1 text-sm text-gray-400">{{ loadError }}</p>
      <button
        class="mt-4 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
        @click="retryLoad"
      >
        重试
      </button>
    </div>

    <!-- 空状态 -->
    <div
      v-else-if="articlesStore.articles.length === 0"
      class="py-20 text-center"
    >
      <p class="text-lg text-gray-400">还没有文章</p>
      <p class="mt-1 text-sm text-gray-400">
        点击右上角「写新文章」开始写作吧
      </p>
    </div>

    <!-- 文章列表 -->
    <div v-else class="grid grid-cols-1 gap-4">
      <ArticleCard
        v-for="article in articlesStore.articles"
        :key="article.id"
        :article="article"
        @delete="handleDelete"
      />
    </div>

    <!-- 删除确认弹窗 -->
    <div
      v-if="showDeleteDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      @click.self="cancelDelete"
    >
      <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          确认删除
        </h3>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
          删除后无法恢复，确定要删除这篇文章吗？
        </p>
        <div class="mt-6 flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            @click="cancelDelete"
          >
            取消
          </button>
          <button
            class="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
            @click="confirmDelete"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import ArticleCard from "../components/ArticleCard.vue";
import { useArticlesStore } from "../stores/articles";

const articlesStore = useArticlesStore();
const showDeleteDialog = ref(false);
const pendingDeleteId = ref(null);
const loadError = ref(null);

async function loadData() {
  loadError.value = null;
  try {
    await articlesStore.loadArticles();
  } catch (e) {
    loadError.value = e.message || "未知错误";
  }
}

function retryLoad() {
  loadData();
}

onMounted(loadData);

async function handleDelete(id) {
  pendingDeleteId.value = id;
  showDeleteDialog.value = true;
}

function cancelDelete() {
  showDeleteDialog.value = false;
  pendingDeleteId.value = null;
}

async function confirmDelete() {
  if (!pendingDeleteId.value) return;
  try {
    await articlesStore.deleteArticle(pendingDeleteId.value);
    window.$toast?.("文章已删除");
  } catch {
    window.$toast?.("删除失败", "error");
  } finally {
    cancelDelete();
  }
}
</script>
