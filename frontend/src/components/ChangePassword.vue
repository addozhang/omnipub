<template>
  <div
    class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800"
  >
    <h2 class="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">
      修改密码
    </h2>

    <form class="max-w-md space-y-4" @submit.prevent="handleSubmit">
      <div>
        <label
          class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >当前密码</label
        >
        <input
          v-model="form.currentPassword"
          type="password"
          autocomplete="current-password"
          required
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>

      <div>
        <label
          class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >新密码</label
        >
        <input
          v-model="form.newPassword"
          type="password"
          autocomplete="new-password"
          required
          minlength="6"
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>

      <div>
        <label
          class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >确认新密码</label
        >
        <input
          v-model="form.confirmPassword"
          type="password"
          autocomplete="new-password"
          required
          minlength="6"
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>

      <!-- 错误/成功提示 -->
      <p v-if="error" class="text-sm text-red-600 dark:text-red-400">
        {{ error }}
      </p>
      <p
        v-if="success"
        class="text-sm text-green-600 dark:text-green-400"
      >
        {{ success }}
      </p>

      <button
        type="submit"
        :disabled="submitting"
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        {{ submitting ? "提交中..." : "修改密码" }}
      </button>
    </form>
  </div>
</template>

<script setup>
import { reactive, ref } from "vue";
import { changePassword } from "../api/user";

const form = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});
const submitting = ref(false);
const error = ref("");
const success = ref("");

async function handleSubmit() {
  error.value = "";
  success.value = "";

  if (form.newPassword !== form.confirmPassword) {
    error.value = "两次输入的新密码不一致";
    return;
  }

  submitting.value = true;
  try {
    await changePassword(form.currentPassword, form.newPassword);
    success.value = "密码修改成功";
    form.currentPassword = "";
    form.newPassword = "";
    form.confirmPassword = "";
  } catch (e) {
    const msg =
      e.response?.data?.message || e.response?.data?.detail || "修改失败";
    error.value = msg;
  } finally {
    submitting.value = false;
  }
}
</script>
