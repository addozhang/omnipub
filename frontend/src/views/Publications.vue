<template>
  <div>
    <h1 class="mb-6 flex items-center text-2xl font-bold text-gray-900 dark:text-gray-100">
      <svg class="mr-2 h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      发布记录
    </h1>

    <div class="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div class="flex items-center space-x-4">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300">平台筛选</label>
        <select
          v-model="selectedPlatform"
          class="block w-48 rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="">全部平台</option>
          <option v-for="p in platformsStore.platforms" :key="p.id" :value="p.slug">
            {{ p.name }}
          </option>
        </select>
        <button
          @click="applyFilter"
          class="inline-flex items-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          筛选
        </button>
        <button
          @click="resetFilter"
          class="inline-flex items-center rounded-md border border-indigo-600 bg-white px-4 py-2 text-sm font-medium text-indigo-600 shadow-sm hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:bg-gray-800 dark:text-indigo-400 dark:hover:bg-gray-700"
        >
          重置
        </button>
      </div>
    </div>

    <h2 class="mb-4 text-lg font-medium text-gray-900 dark:text-gray-100">发布记录列表</h2>

    <div v-if="loading" class="py-20 text-center text-gray-400">
      加载中...
    </div>

    <div v-else-if="filteredRecords.length === 0" class="py-20 text-center">
      <p class="text-lg text-gray-400">暂无发布记录</p>
      <p class="mt-1 text-sm text-gray-400">试试调整筛选条件或发布新文章</p>
    </div>

    <!-- 发布记录表格 -->
    <div
      v-else
      class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <table class="w-full text-left text-sm" aria-label="发布记录">
        <thead>
          <tr
            class="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
          >
            <th scope="col" class="w-16 px-4 py-3 font-medium text-gray-600 dark:text-gray-400 text-center">
              平台
            </th>
            <th scope="col" class="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
              文章标题
            </th>
            <th scope="col" class="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
              文章链接
            </th>
            <th scope="col" class="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
              阅读数
            </th>
            <th scope="col" class="px-4 py-3 font-medium text-gray-600 dark:text-gray-400 text-center">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="record in paginatedRecords"
            :key="record.pub.id"
            class="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-750"
          >
            <td class="px-4 py-3 text-center">
              <img
                :src="getPlatformIcon(record.pub)"
                class="mx-auto h-6 w-6 rounded-full bg-gray-100 dark:bg-gray-700"
                :alt="record.pub.platform_name || '平台图标'"
              />
            </td>
            <td class="max-w-[200px] truncate px-4 py-3 font-medium">
              <router-link
                :to="`/articles/${record.articleId}/edit`"
                class="text-indigo-600 hover:text-indigo-800 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                {{ record.articleTitle }}
              </router-link>
            </td>
            <td class="px-4 py-3 text-gray-500 dark:text-gray-400">
              <a
                v-if="record.pub.article_url"
                :href="record.pub.article_url"
                target="_blank"
                class="inline-flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="在新标签页中打开"
              >
                <span class="max-w-[150px] truncate">{{ record.pub.article_url }}</span>
                <svg class="ml-1 h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              <span v-else class="text-gray-400">—</span>
            </td>
            <td class="px-4 py-3">
              <span v-if="(record.pub.latest_stats?.view_count || 0) > 0" :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', getBadgeColor(record.pub.latest_stats.view_count)]">
                {{ record.pub.latest_stats.view_count }}
              </span>
              <span v-else class="text-gray-500 dark:text-gray-400">—</span>
            </td>
            <td class="px-4 py-3 text-center">
              <div class="flex justify-center space-x-2">
                <button
                  class="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                  title="同步数据"
                  @click="syncData(record)"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                <button
                  class="text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                  title="删除记录"
                  @click="deleteRecord(record)"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      
      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6 dark:border-gray-700 dark:bg-gray-800">
        <div class="flex flex-1 justify-between sm:hidden">
          <button @click="prevPage" :disabled="currentPage === 1" class="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">上一页</button>
          <button @click="nextPage" :disabled="currentPage === totalPages" class="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">下一页</button>
        </div>
        <div class="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
          <div>
            <p class="text-sm text-gray-700 dark:text-gray-300">
              显示第 <span class="font-medium">{{ (currentPage - 1) * pageSize + 1 }}</span> 到 <span class="font-medium">{{ Math.min(currentPage * pageSize, filteredRecords.length) }}</span> 条，共 <span class="font-medium">{{ filteredRecords.length }}</span> 条记录
            </p>
          </div>
          <div>
            <nav class="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
              <button @click="prevPage" :disabled="currentPage === 1" class="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 dark:ring-gray-600 dark:hover:bg-gray-700">
                <span class="sr-only">Previous</span>
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" />
                </svg>
              </button>
              
              <template v-for="(page, idx) in visiblePages" :key="idx">
                <span v-if="page === '...'" class="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 focus:outline-offset-0 dark:text-gray-300 dark:ring-gray-600">...</span>
                <button
                  v-else
                  @click="goToPage(page)"
                  :class="[
                    page === currentPage
                      ? 'relative z-10 inline-flex items-center bg-indigo-600 px-4 py-2 text-sm font-semibold text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
                      : 'relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 dark:text-gray-200 dark:ring-gray-600 dark:hover:bg-gray-700'
                  ]"
                >
                  {{ page }}
                </button>
              </template>

              <button @click="nextPage" :disabled="currentPage === totalPages" class="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 dark:ring-gray-600 dark:hover:bg-gray-700">
                <span class="sr-only">Next</span>
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                </svg>
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { getArticles } from "../api/articles";
import { getPublicationsBatch } from "../api/publications";
import { usePlatformsStore } from "../stores/platforms";

const platformsStore = usePlatformsStore();

const loading = ref(true);
const records = ref([]);

// Pagination & Filtering state
const selectedPlatform = ref("");
const currentPage = ref(1);
const pageSize = ref(10);

onMounted(async () => {
  // Load platforms for filter
  if (platformsStore.platforms.length === 0) {
    await platformsStore.loadPlatforms();
  }

  try {
    const articlesRes = await getArticles(0, 100);
    const articles = articlesRes.data || [];

    const articleIds = articles.map(a => a.id);
    let pubsByArticle = [];
    if (articleIds.length > 0) {
      try {
        const batchRes = await getPublicationsBatch(articleIds);
        const grouped = batchRes.data || {};
        pubsByArticle = articleIds.map(id => {
          const pubs = grouped[id] || [];
          return pubs.map((pub) => ({
            articleId: id,
            articleTitle: articles.find(a => a.id === id)?.title || "",
            pub,
          }));
        });
      } catch {
        pubsByArticle = [];
      }
    }

    const allRecords = pubsByArticle.flat();

    // 按时间倒序
    allRecords.sort(
      (a, b) =>
        new Date(b.pub.created_at).getTime() -
        new Date(a.pub.created_at).getTime(),
    );
    records.value = allRecords;
  } catch {
    window.$toast?.("加载发布记录失败", "error");
  } finally {
    loading.value = false;
  }
});

const filteredRecords = computed(() => {
  if (!selectedPlatform.value) {
    return records.value;
  }
  return records.value.filter(
    (record) => 
      record.pub.platform_slug === selectedPlatform.value || 
      record.pub.platform_name === selectedPlatform.value
  );
});

const totalPages = computed(() => Math.ceil(filteredRecords.value.length / pageSize.value) || 1);

const paginatedRecords = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredRecords.value.slice(start, end);
});

const visiblePages = computed(() => {
  const total = totalPages.value;
  const current = currentPage.value;
  const delta = 2; // Show current +- delta
  const range = [];
  const rangeWithDots = [];
  let l;

  for (let i = 1; i <= total; i++) {
    if (i == 1 || i == total || (i >= current - delta && i <= current + delta)) {
      range.push(i);
    }
  }

  for (let i of range) {
    if (l) {
      if (i - l === 2) {
        rangeWithDots.push(l + 1);
      } else if (i - l !== 1) {
        rangeWithDots.push("...");
      }
    }
    rangeWithDots.push(i);
    l = i;
  }

  return rangeWithDots;
});

function applyFilter() {
  currentPage.value = 1;
}

function resetFilter() {
  selectedPlatform.value = "";
  currentPage.value = 1;
}

function goToPage(page) {
  if (page !== "..." && page >= 1 && page <= totalPages.value) {
    currentPage.value = page;
  }
}

function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--;
  }
}

function nextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++;
  }
}

function getPlatformIcon(pub) {
  if (pub.platform_icon_url) {
    return pub.platform_icon_url;
  }
  if (pub.article_url) {
    try {
      const url = new URL(pub.article_url);
      return `https://www.google.com/s2/favicons?domain=${url.hostname}`;
    } catch {
      // invalid URL
    }
  }
  return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-globe"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
}

function getBadgeColor(count) {
  if (count >= 500) {
    return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
  } else if (count >= 100) {
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  } else {
    return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  }
}

function syncData(record) {
  window.$toast?.("同步功能开发中，敬请期待", "info");
}

function deleteRecord(record) {
  window.$toast?.("删除功能开发中，敬请期待", "info");
}
</script>
