<template>
  <div
    class="group relative cursor-pointer rounded-xl border-2 p-4 transition-all"
    :class="cardClass"
    @click="openLoginUrl"
  >
    <!-- 右上角 checkbox -->
    <div class="absolute top-2 right-2" @click.stop>
      <input
        type="checkbox"
        :checked="selected"
        class="h-4 w-4 cursor-pointer rounded border-gray-300 accent-indigo-500"
        :class="selected ? 'border-indigo-500' : 'border-gray-300'"
        @change="$emit('toggle')"
      />
    </div>

    <!-- 图标 -->
    <div
      class="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 overflow-hidden"
    >
      <img
        v-if="faviconUrl && !imgFailed"
        :src="faviconUrl"
        :alt="platform.name"
        class="h-8 w-8 object-contain"
        @error="onImgError"
      />
      <span v-else class="text-2xl">🌐</span>
    </div>

    <!-- 名称 -->
    <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
      {{ platform.name }}
    </h3>

    <!-- 状态 -->
    <div class="mt-1 flex items-center gap-1.5">
      <span class="h-2 w-2 rounded-full" :class="statusDot"></span>
      <span class="text-xs text-gray-500 dark:text-gray-400">{{
        statusText
      }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  platform: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
defineEmits(["toggle"]);

function openLoginUrl() {
  const url = props.platform.new_article_url;
  if (url) {
    window.open(url, "_blank");
  }
}

const faviconUrl = computed(() => {
  const url = props.platform.new_article_url;
  if (!url) return null;
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return null;
  }
});

const imgFailed = ref(false);
function onImgError() {
  imgFailed.value = true;
}

const statusDot = computed(() => {
  const map = {
    active: "bg-green-500",
    degraded: "bg-yellow-500",
    broken: "bg-red-500",
  };
  return map[props.platform.status] || "bg-gray-400";
});

const statusText = computed(() => {
  const map = {
    active: "正常",
    degraded: "不稳定",
    broken: "不可用",
  };
  return map[props.platform.status] || "未知";
});

const cardClass = computed(() => {
  if (props.selected) {
    return "border-indigo-500 bg-indigo-50 dark:bg-indigo-950";
  }
  return "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600";
});
</script>
