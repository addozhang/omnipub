<template>
  <div class="relative group rounded-xl border border-gray-200 bg-white p-5 transition-all hover:shadow-md dark:border-gray-700 dark:bg-gray-800 flex flex-col sm:flex-row gap-5 sm:items-center">
    
    <!-- Delete Button (Top Right Absolute) -->
    <button
      class="absolute top-4 right-4 text-gray-300 hover:text-red-500 transition-colors hover:bg-red-50 p-1 rounded-md dark:text-gray-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
      @click="$emit('delete', article.id)"
      title="删除文章"
      aria-label="删除文章"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
      </svg>
    </button>

    <!-- Main Content Left -->
    <div class="flex-1 min-w-0">
      <div class="flex flex-wrap items-center gap-3 pr-8 mb-1">
        <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 truncate max-w-full">
          {{ article.title }}
        </h3>
      </div>
      
      <p class="text-xs text-gray-400 dark:text-gray-500">
        {{ formatDate(article.created_at) }}
      </p>
    </div>

    <!-- Actions Right -->
    <div class="flex sm:flex-col items-center sm:items-stretch justify-end gap-2.5 shrink-0 mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-700/50">
      <router-link
        :to="`/articles/${article.id}/edit`"
        class="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 sm:px-3 sm:py-1.5 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 hover:text-gray-900 rounded-lg transition-colors dark:text-gray-300 dark:bg-gray-700/40 dark:hover:bg-gray-700 dark:hover:text-white"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.828-2.828z" />
        </svg>
        编辑
      </router-link>
      <router-link
        :to="`/articles/${article.id}/publish`"
        class="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 sm:px-3 sm:py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-700 rounded-lg transition-colors dark:text-indigo-400 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40 dark:hover:text-indigo-300"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
        </svg>
        分发
      </router-link>
    </div>

  </div>
</template>

<script setup>
const props = defineProps({
  article: { type: Object, required: true },
});
defineEmits(["delete"]);

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
</script>
