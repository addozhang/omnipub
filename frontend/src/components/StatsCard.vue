<template>
  <div
    class="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
  >
    <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
      {{ label }}
    </p>
    <p class="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">
      {{ displayValue }}
    </p>
    <p v-if="sub" class="mt-1 text-sm text-gray-400 dark:text-gray-500">
      {{ sub }}
    </p>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  label: { type: String, required: true },
  value: { type: Number, default: 0 },
  sub: { type: String, default: "" },
});

const displayValue = computed(() => {
  if (props.value >= 10000) {
    return (props.value / 10000).toFixed(1) + "w";
  }
  return props.value.toLocaleString();
});
</script>
