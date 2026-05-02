<template>
  <div
    class="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900"
  >
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <div
          class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500 text-xl font-bold text-white"
        >
          MP
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Omnipub
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          多平台文章一键发布工具
        </p>
      </div>

      <!-- 卡片 -->
      <div
        class="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <!-- Tab 切换 -->
        <div class="mb-6 flex rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
          <button
            class="flex-1 rounded-md py-2 text-sm font-medium transition-colors"
            :class="
              isLogin
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            "
            @click="isLogin = true"
          >
            登录
          </button>
          <button
            class="flex-1 rounded-md py-2 text-sm font-medium transition-colors"
            :class="
              !isLogin
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            "
            @click="isLogin = false"
          >
            注册
          </button>
        </div>

        <form @submit.prevent="handleSubmit">
          <!-- Email -->
          <div class="mb-4">
            <label
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >邮箱</label
            >
            <input
              v-model="form.email"
              type="email"
              required
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="your@email.com"
            />
          </div>

          <!-- Username (注册时显示) -->
          <div v-if="!isLogin" class="mb-4">
            <label
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >用户名</label
            >
            <input
              v-model="form.username"
              type="text"
              required
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="请输入用户名"
            />
          </div>

          <!-- Password -->
          <div class="mb-6">
            <label
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >密码</label
            >
            <input
              v-model="form.password"
              type="password"
              required
              minlength="6"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="至少 6 位密码"
            />
          </div>

          <!-- Error -->
          <p
            v-if="error"
            class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400"
          >
            {{ error }}
          </p>

          <!-- Submit -->
          <button
            type="submit"
            :disabled="loading"
            class="w-full rounded-lg bg-indigo-500 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ loading ? "处理中..." : isLogin ? "登录" : "注册" }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const authStore = useAuthStore();

const isLogin = ref(true);
const loading = ref(false);
const error = ref("");
const form = reactive({
  email: "",
  username: "",
  password: "",
});

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    if (isLogin.value) {
      await authStore.login(form.email, form.password);
    } else {
      await authStore.register(form.email, form.username, form.password);
    }
    router.push("/articles");
  } catch (err) {
    error.value =
      err.response?.data?.detail ||
      err.response?.data?.message ||
      "操作失败，请重试";
  } finally {
    loading.value = false;
  }
}
</script>
