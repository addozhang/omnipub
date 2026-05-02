<template>
  <div class="flex h-screen">
    <Sidebar
      :collapsed="sidebarCollapsed"
      @close="sidebarCollapsed = true"
    />
    <div class="flex min-h-0 flex-1 flex-col overflow-auto">
      <header
        class="sticky top-0 z-10 flex h-14 shrink-0 items-center border-b border-gray-200 bg-white/80 px-6 backdrop-blur dark:border-gray-700 dark:bg-gray-900/80 lg:hidden"
      >
        <button
          class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <svg
            class="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <span class="ml-3 text-lg font-semibold">Omnipub</span>
      </header>
      <main class="flex min-h-0 flex-1 flex-col p-6">
        <ExtensionBanner class="mb-4 shrink-0" />
        <router-view class="min-h-0 flex-1" />
      </main>
    </div>
    <!-- 移动端遮罩 -->
    <div
      v-if="!sidebarCollapsed"
      class="fixed inset-0 z-20 bg-black/50 lg:hidden"
      @click="sidebarCollapsed = true"
    ></div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import Sidebar from "./Sidebar.vue";
import ExtensionBanner from "./ExtensionBanner.vue";

const sidebarCollapsed = ref(true);
</script>
