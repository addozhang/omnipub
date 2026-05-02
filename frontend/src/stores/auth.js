import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { loginApi, registerApi } from "../api/auth";

/**
 * 将 JWT token 同步给 Omnipub 扩展的 service worker。
 * 通过 CustomEvent 经 content script（page-bridge）转发给 service worker。
 */
function syncTokenToExtension(token) {
  try {
    window.dispatchEvent(
      new CustomEvent("omnipub:set-token", { detail: { token } })
    );
  } catch (e) {
    // 扩展未安装时忽略
  }
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref(localStorage.getItem("token") || "");
  const user = ref(JSON.parse(localStorage.getItem("user") || "null"));

  // Fix: 页面加载时如果 localStorage 已有 token，立即同步到扩展。
  // 解决扩展卸载重装后丢失 token 的问题（用户无需重新登录即可恢复扩展 session）。
  if (token.value) {
    syncTokenToExtension(token.value);
  }

  const isLoggedIn = computed(() => !!token.value);

  async function login(email, password) {
    const res = await loginApi(email, password);
    token.value = res.data.token.access_token;
    user.value = res.data.user;
    localStorage.setItem("token", token.value);
    localStorage.setItem("user", JSON.stringify(user.value));
    syncTokenToExtension(token.value);
    return res;
  }

  async function register(email, username, password) {
    const res = await registerApi(email, username, password);
    token.value = res.data.token.access_token;
    user.value = res.data.user;
    localStorage.setItem("token", token.value);
    localStorage.setItem("user", JSON.stringify(user.value));
    syncTokenToExtension(token.value);
    return res;
  }

  function logout() {
    token.value = "";
    user.value = null;
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    syncTokenToExtension(null);  // 清除扩展 token
  }

  return { token, user, isLoggedIn, login, register, logout };
});
