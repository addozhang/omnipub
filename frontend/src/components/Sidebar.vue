<template>
  <aside
    class="fixed z-30 flex h-screen w-64 flex-col bg-gray-900 text-gray-100 transition-transform duration-300 lg:static lg:translate-x-0"
    :class="collapsed ? '-translate-x-full' : 'translate-x-0'"
  >
    <!-- Logo -->
    <div class="flex h-14 items-center gap-2 border-b border-gray-700 px-4">
      <div
        class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold"
      >
        MP
      </div>
      <span class="text-lg font-semibold">Omnipub</span>
    </div>

    <!-- 导航菜单 -->
    <nav class="flex-1 space-y-1 px-3 py-4">
      <router-link
        v-for="item in menuItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-gray-800"
        :class="isActive(item.to) ? '!bg-indigo-600 text-white' : ''"
        @click="$emit('close')"
      >
        <span class="text-lg">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <!-- 用户信息 -->
    <div class="border-t border-gray-700 p-4">
      <router-link
        to="/user/settings"
        class="flex items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-gray-800"
        @click="$emit('close')"
      >
        <div
          class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-600 text-sm font-medium"
        >
          {{ userInitial }}
        </div>
        <div class="flex-1 truncate">
          <p class="truncate text-sm font-medium">
            {{ user?.username || "用户" }}
          </p>
          <p class="truncate text-xs text-gray-400">
            {{ user?.email || "" }}
          </p>
        </div>
      </router-link>
      <button
        class="mt-3 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
        @click="handleLogout"
      >
        退出登录
      </button>
    </div>
  </aside>
</template>

<script setup>
import { computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";

defineProps({
  collapsed: { type: Boolean, default: true },
});
defineEmits(["close"]);

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

// 精确匹配：/ 只在首页高亮，其他路由前缀匹配
function isActive(to) {
  if (to === "/") return route.path === "/";
  return route.path.startsWith(to);
}

const user = computed(() => authStore.user);
const userInitial = computed(() => {
  const name = authStore.user?.username || "U";
  return name.charAt(0).toUpperCase();
});

const menuItems = [
  { to: "/", label: "仪表盘", icon: "📊" },
  { to: "/articles", label: "我的文章", icon: "📝" },
  { to: "/publications", label: "发布记录", icon: "📤" },
  { to: "/settings", label: "渠道设置", icon: "⚙️" },
];

function handleLogout() {
  authStore.logout();
  router.push("/login");
}
</script>
