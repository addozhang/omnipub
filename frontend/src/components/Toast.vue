<template>
  <div
    v-if="visible"
    role="alert"
    class="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg transition-all duration-300"
    :class="typeClass"
  >
    <span class="text-sm font-medium">{{ message }}</span>
    <button
      class="ml-2 text-current opacity-60 hover:opacity-100"
      @click="hide"
    >
      ✕
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";

const visible = ref(false);
const message = ref("");
const type = ref("success");

const typeClass = computed(() => {
  const map = {
    success: "bg-green-500 text-white",
    error: "bg-red-500 text-white",
    warning: "bg-yellow-500 text-white",
    info: "bg-blue-500 text-white",
  };
  return map[type.value] || map.info;
});

let timer = null;

function show(msg, t = "success", duration = 3000) {
  message.value = msg;
  type.value = t;
  visible.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    visible.value = false;
  }, duration);
}

function hide() {
  visible.value = false;
  clearTimeout(timer);
}

// 暴露全局方法（fallback 到 console 避免静默失败）
window.$toast = show;

// 开发环境下若 toast 未初始化，fallback 到 console
if (import.meta.env.DEV) {
  const origToast = window.$toast;
  window.$toast = (msg, type = "success") => {
    origToast?.(msg, type);
    if (type === "error") console.error("[Toast]", msg);
    else if (type === "warning") console.warn("[Toast]", msg);
    else console.info("[Toast]", msg);
  };
}

defineExpose({ show, hide });
</script>
