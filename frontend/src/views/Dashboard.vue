<template>
  <div>
    <!-- Loading state -->
    <div
      v-if="loading"
      class="flex items-center justify-center py-16"
    >
      <svg class="h-8 w-8 animate-spin text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span class="ml-3 text-gray-500 dark:text-gray-400">加载中...</span>
    </div>

    <!-- H-U4: Error state -->
    <div
      v-else-if="loadError"
      class="mb-6 rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20"
    >
      <p class="text-sm font-medium text-red-700 dark:text-red-400">{{ loadError }}</p>
      <button
        @click="reload"
        class="mt-3 rounded-md bg-red-100 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/60"
      >
        重新加载
      </button>
    </div>

    <template v-else>
    <div class="mb-8 flex flex-col justify-between gap-6 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-500 to-purple-400 p-8 text-white shadow-lg md:flex-row md:items-center">
      <div>
        <h1 class="mb-2 text-3xl font-bold">欢迎回来！</h1>
        <p class="text-lg text-white/90">开始您的创作之旅，将优质内容分享给更多读者。</p>
      </div>
      <div class="flex gap-6">
        <div class="flex items-center gap-4">
          <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <div>
            <div class="text-sm text-white/80">总文章数</div>
            <div class="text-3xl font-bold">{{ totalArticles }}</div>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
            </svg>
          </div>
          <div>
            <div class="text-sm text-white/80">发布次数</div>
            <div class="text-3xl font-bold">{{ totalPublications }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 快速操作 -->
    <div class="mb-8">
      <h2 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">快速操作</h2>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <router-link to="/articles/new" class="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-6 transition-all hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
            <svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-medium text-gray-900 transition-colors group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400">写新文章</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">开始创作新的内容</p>
          </div>
        </router-link>

        <router-link to="/articles" class="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-6 transition-all hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            <svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path>
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-medium text-gray-900 transition-colors group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400">管理文章</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">查看和管理已发表文章</p>
          </div>
        </router-link>
      </div>
    </div>

    <!-- 各平台发布数量 -->
    <div
      class="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
    >
      <h2
        class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100"
      >
        各平台发布统计
      </h2>

      <div v-if="platformStats.length === 0" class="py-8 text-center text-gray-400">
        暂无发布数据
      </div>

      <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <div
          v-for="stat in platformStats"
          :key="stat.name"
          class="flex items-center gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 transition-all hover:shadow-md dark:border-gray-700 dark:bg-gray-800/50"
        >
          <img
            v-if="stat.icon_url && !stat.iconFailed"
            :src="stat.icon_url"
            class="h-8 w-8 shrink-0 rounded object-contain"
            :alt="stat.name"
            @error="stat.iconFailed = true"
          />
          <div
            v-else
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-500 dark:bg-gray-600 dark:text-gray-300"
          >
            {{ stat.name.charAt(0) }}
          </div>
          <div class="flex-1 overflow-hidden">
            <div class="truncate text-sm font-medium text-gray-500 dark:text-gray-400">
              {{ stat.name }}
            </div>
            <div class="mt-1 text-2xl font-bold leading-none text-gray-900 dark:text-white">
              {{ stat.count }}
            </div>
          </div>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { getArticles } from "../api/articles";
import { getPlatforms } from "../api/platforms";
import { getPublicationsBatch } from "../api/publications";

const totalArticles = ref(0);
const totalPublications = ref(0);
const totalViews = ref(0);
const platformStats = ref([]);
const loadError = ref(null); // H-U4: Track loading errors
const loading = ref(true);

function reload() {
  window.location.reload();
}

onMounted(async () => {
  try {
    // 加载文章
    const articlesRes = await getArticles(0, 100);
    const articles = articlesRes.data || [];
    totalArticles.value = articles.length;

    // 加载平台
    const platformsRes = await getPlatforms();
    const platforms = platformsRes.data || [];

    // 收集所有发布记录
    const pubCountMap = {};
    platforms.forEach((p) => {
      let favicon = p.icon_url;
      // Use Google favicon service as primary source (more reliable than direct icon URLs)
      try {
        const url = p.new_article_url || '';
        if (url) {
          const domain = new URL(url).hostname;
          favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        }
      } catch {}
      pubCountMap[p.id] = { name: p.name, count: 0, icon_url: favicon };
    });

    let pubTotal = 0;
    let viewTotal = 0;

    const articleIds = articles.map(a => a.id);
    let pubsByArticle = [];
    if (articleIds.length > 0) {
      try {
        const batchRes = await getPublicationsBatch(articleIds);
        const grouped = batchRes.data || {};
        pubsByArticle = articleIds.map(id => grouped[id] || []);
      } catch {
        pubsByArticle = articleIds.map(() => []);
      }
    }

    for (const pubs of pubsByArticle) {
      pubTotal += pubs.length;

      for (const pub of pubs) {
        if (pubCountMap[pub.platform_id]) {
          pubCountMap[pub.platform_id].count++;
        }
        if (pub.latest_stats) {
          viewTotal += pub.latest_stats.view_count || 0;
        }
      }
    }

    totalPublications.value = pubTotal;
    totalViews.value = viewTotal;

    const maxCount = Math.max(
      ...Object.values(pubCountMap).map((s) => s.count),
      1,
    );
    platformStats.value = Object.values(pubCountMap).map((s) => ({
      name: s.name,
      icon_url: s.icon_url,
      iconFailed: false,
      count: s.count,
      percentage: (s.count / maxCount) * 100,
    })).sort((a, b) => b.count - a.count);
  } catch (err) {
    // H-U4: Show error state instead of blank page
    loadError.value = err?.response?.data?.message || err?.message || "加载数据失败，请稍后重试";
  } finally {
    loading.value = false;
  }
});
</script>
