<template>
  <div class="mx-auto max-w-3xl">
    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
      用户设置
    </h1>

    <!-- Tab 切换 -->
    <div class="mb-6 border-b border-gray-200 dark:border-gray-700">
      <nav class="-mb-px flex gap-6">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors"
          :class="
            activeTab === tab.key
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <!-- Tab 内容 -->
    <ChangePassword v-if="activeTab === 'password'" />
    <ApiKeyManager v-else-if="activeTab === 'apikeys'" />
  </div>
</template>

<script setup>
import { ref } from "vue";
import ChangePassword from "../components/ChangePassword.vue";
import ApiKeyManager from "../components/ApiKeyManager.vue";

const tabs = [
  { key: "password", label: "修改密码" },
  { key: "apikeys", label: "API 密钥" },
];

const activeTab = ref("password");
</script>
