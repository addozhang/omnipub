<template>
  <!-- 未安装 -->
  <div
    v-if="!dismissed && status === 'not-installed'"
    class="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
  >
    <svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
    <span class="flex-1">
      未检测到 Omnipub 扩展，发布功能需要先安装 Chrome 扩展。
    </span>
    <a
      :href="RELEASES_URL"
      target="_blank"
      class="shrink-0 rounded bg-amber-600 px-3 py-1 text-white hover:bg-amber-700"
    >
      去安装
    </a>
    <button class="shrink-0 text-amber-500 hover:text-amber-700" @click="dismissed = true" aria-label="关闭提示">
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>

  <!-- 版本过旧 -->
  <div
    v-else-if="!dismissed && status === 'outdated'"
    class="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
  >
    <svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
    <span class="flex-1">
      扩展版本 <strong>v{{ installedVersion }}</strong> 已过时，最新版本为
      <strong>v{{ latestVersion }}</strong>，建议更新以获得最佳体验。
    </span>
    <a
      :href="RELEASES_URL"
      target="_blank"
      class="shrink-0 rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
    >
      去更新
    </a>
    <button class="shrink-0 text-blue-400 hover:text-blue-600" @click="dismissed = true" aria-label="关闭提示">
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useExtension } from "@/composables/useExtension";

const RELEASES_URL = "https://github.com/addozhang/omnipub/releases/latest";

const { status, installedVersion, latestVersion } = useExtension();
const dismissed = ref(false);
</script>
