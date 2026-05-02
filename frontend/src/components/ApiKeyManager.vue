<template>
  <div
    class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800"
  >
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
        API 密钥
      </h2>
      <button
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        @click="showCreateModal = true"
      >
        创建密钥
      </button>
    </div>

    <!-- 支持的 API 说明 -->
    <div
      class="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
    >
      <p class="mb-2 text-sm font-medium text-blue-800 dark:text-blue-300">
        当前支持的 API 接口：
      </p>
      <ul class="list-inside list-disc space-y-1 text-sm text-blue-700 dark:text-blue-400">
        <li>
          <code class="rounded bg-blue-100 px-1 py-0.5 text-xs dark:bg-blue-900"
            >POST /api/articles</code
          >
          — 创建文章
        </li>
      </ul>
      <p class="mt-2 text-xs text-blue-500 dark:text-blue-500">
        后续将开放更多接口。
      </p>
    </div>

    <!-- 使用说明 -->
    <div
      class="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50"
    >
      <p class="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
        使用方法：
      </p>
      <code
        class="block rounded bg-gray-100 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        >Authorization: Bearer omnk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code
      >
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-10 text-center text-gray-400">
      加载中...
    </div>

    <!-- 空状态 -->
    <div
      v-else-if="keys.length === 0"
      class="py-10 text-center text-gray-400"
    >
      暂无 API 密钥，点击上方按钮创建。
    </div>

    <!-- 密钥列表 -->
    <div v-else class="space-y-3">
      <div
        v-for="key in keys"
        :key="key.id"
        class="flex flex-col gap-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0 flex-1">
          <p class="font-medium text-gray-900 dark:text-gray-100">
            {{ key.name }}
          </p>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            <code class="text-xs">{{ key.key_prefix }}••••••••</code>
            <span class="mx-2">|</span>
            <span>创建于 {{ formatDate(key.created_at) }}</span>
            <template v-if="key.last_used_at">
              <span class="mx-2">|</span>
              <span>最后使用 {{ formatDate(key.last_used_at) }}</span>
            </template>
          </p>
        </div>
        <div class="flex shrink-0 gap-2">
          <button
            class="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            @click="handleRegenerate(key)"
          >
            重新生成
          </button>
          <button
            class="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
            @click="handleDelete(key)"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <ApiKeyModal
      v-if="showCreateModal"
      ref="createModalRef"
      mode="create"
      @close="showCreateModal = false"
      @created="doCreate"
    />

    <!-- Reveal Modal (after create / regenerate) -->
    <ApiKeyModal
      v-if="showRevealModal"
      mode="reveal"
      :reveal-key="revealedKey"
      :reveal-title="revealTitle"
      @close="showRevealModal = false"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import {
  listApiKeys,
  createApiKey,
  regenerateApiKey,
  deleteApiKey,
} from "../api/apiKeys";
import ApiKeyModal from "./ApiKeyModal.vue";

const keys = ref([]);
const loading = ref(true);

const showCreateModal = ref(false);
const createModalRef = ref(null);

const showRevealModal = ref(false);
const revealedKey = ref("");
const revealTitle = ref("API 密钥已生成");

onMounted(loadKeys);

async function loadKeys() {
  loading.value = true;
  try {
    const res = await listApiKeys();
    keys.value = res.data || [];
  } catch (e) {
    console.error("Failed to load API keys:", e);
    keys.value = [];
  } finally {
    loading.value = false;
  }
}

async function doCreate(name) {
  const modal = createModalRef.value;
  if (modal) modal.submitting = true;
  try {
    const res = await createApiKey(name);
    showCreateModal.value = false;
    revealedKey.value = res.data.key;
    revealTitle.value = "API 密钥已创建";
    showRevealModal.value = true;
    await loadKeys();
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.detail || "创建失败";
    window.$toast?.(msg, "error");
  } finally {
    if (modal) modal.submitting = false;
  }
}

async function handleRegenerate(key) {
  if (!confirm(`确定要重新生成密钥「${key.name}」吗？旧密钥将立即失效。`)) return;
  try {
    const res = await regenerateApiKey(key.id);
    revealedKey.value = res.data.key;
    revealTitle.value = "密钥已重新生成";
    showRevealModal.value = true;
    await loadKeys();
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.detail || "重新生成失败";
    window.$toast?.(msg, "error");
  }
}

async function handleDelete(key) {
  if (!confirm(`确定要删除密钥「${key.name}」吗？此操作不可撤销。`)) return;
  try {
    await deleteApiKey(key.id);
    window.$toast?.("密钥已删除", "success");
    await loadKeys();
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.detail || "删除失败";
    window.$toast?.(msg, "error");
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
</script>
