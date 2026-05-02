<template>
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @click.self="$emit('close')"
  >
    <div
      class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800"
    >
      <!-- Create mode -->
      <template v-if="mode === 'create'">
        <h3 class="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">
          创建 API 密钥
        </h3>
        <form @submit.prevent="handleCreate">
          <label
            class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >密钥名称</label
          >
          <input
            ref="nameInput"
            v-model="name"
            type="text"
            required
            maxlength="100"
            placeholder="例如: CI/CD Pipeline"
            class="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <div class="flex justify-end gap-3">
            <button
              type="button"
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              @click="$emit('close')"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              {{ submitting ? "创建中..." : "创建" }}
            </button>
          </div>
        </form>
      </template>

      <!-- Reveal mode (show plaintext key) -->
      <template v-else-if="mode === 'reveal'">
        <h3 class="mb-2 text-lg font-bold text-gray-900 dark:text-gray-100">
          {{ revealTitle }}
        </h3>
        <p class="mb-4 text-sm text-amber-600 dark:text-amber-400">
          请立即复制此密钥，关闭后将无法再次查看。
        </p>
        <div
          class="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900"
        >
          <code
            class="flex-1 break-all text-sm text-gray-800 dark:text-gray-200"
            >{{ revealKey }}</code
          >
          <button
            class="shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors"
            :class="
              copied
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            "
            @click="copyKey"
          >
            {{ copied ? "已复制" : "复制" }}
          </button>
        </div>
        <div class="flex justify-end">
          <button
            class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            @click="$emit('close')"
          >
            我已保存密钥
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from "vue";

const props = defineProps({
  mode: { type: String, required: true }, // 'create' | 'reveal'
  revealKey: { type: String, default: "" },
  revealTitle: { type: String, default: "API 密钥已生成" },
});

const emit = defineEmits(["close", "created"]);

const name = ref("");
const submitting = ref(false);
const copied = ref(false);
const nameInput = ref(null);

onMounted(async () => {
  if (props.mode === "create") {
    await nextTick();
    nameInput.value?.focus();
  }
});

function handleCreate() {
  if (!name.value.trim()) return;
  emit("created", name.value.trim());
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(props.revealKey);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // fallback
    const textarea = document.createElement("textarea");
    textarea.value = props.revealKey;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
}

// Expose submitting for parent to set during async
defineExpose({ submitting });
</script>
