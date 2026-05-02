<template>
  <div class="mx-auto max-w-3xl">
    <!-- Header 与操作栏 -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          渠道设置
        </h1>
      </div>
      <button
        class="flex items-center gap-1 rounded px-4 py-2 text-sm font-medium transition-colors"
        :class="checkingLogin
          ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800'
          : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-400'"
        :disabled="checkingLogin"
        @click="checkLoginStatus"
      >
        <span v-if="checkingLogin">⏳ 检测中...</span>
        <span v-else>🔍 检查登录状态</span>
      </button>
    </div>

    <!-- 登录检测结果 banner -->
    <div v-if="loginCheckResult" class="mb-6 rounded-lg p-4"
      :class="loginCheckResult.type === 'error'
        ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
        : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="w-full">
          <p class="font-medium">{{ loginCheckResult.message }}</p>
          <!-- 未登录平台（红色） -->
          <ul v-if="loginCheckResult.type === 'error' && loginCheckResult.platforms?.length" class="mt-1 list-disc pl-5 text-sm">
            <li v-for="p in loginCheckResult.platforms" :key="p.slug">
              {{ p.name }} <span class="opacity-60">— 未登录</span>
            </li>
          </ul>
          <!-- 已登录平台（绿色时显示列表） -->
          <ul v-if="loginCheckResult.type === 'success' && loginCheckResult.platforms?.length" class="mt-1 list-none pl-0 text-sm space-y-0.5">
            <li v-for="p in loginCheckResult.platforms" :key="p.slug" class="flex items-center gap-1">
              <span class="text-green-500">✓</span> {{ p.name }}
            </li>
          </ul>
          <!-- 成功但有失败：显示已登录的 -->
          <div v-if="loginCheckResult.loggedInPlatforms?.length" class="mt-2 text-sm opacity-70">
            <span>已登录：</span>
            <span v-for="(p, i) in loginCheckResult.loggedInPlatforms" :key="p.slug">
              {{ p.name }}<span v-if="i < loginCheckResult.loggedInPlatforms.length - 1">、</span>
            </span>
          </div>
        </div>
        <button class="shrink-0 text-current opacity-60 hover:opacity-100" @click="loginCheckResult = null">✕</button>
      </div>
    </div>

    <!-- 平台设置卡片 -->
    <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h2 class="mb-2 text-lg font-bold text-gray-900 dark:text-gray-100">
        ≡ 常用发布平台设置
      </h2>
      <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
        选择您常用的发布平台,在发布文章时将只显示选中的平台,让发布流程更加简洁高效。如果不选择任何平台,则默认显示所有平台。
      </p>

      <!-- 平台网格 -->
      <div v-if="platformsStore.loading" class="py-20 text-center text-gray-400">
        加载中...
      </div>
      <div v-else>
        <!-- 全选 / 取消全选 -->
        <div class="mb-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/50">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              :checked="allEnabled"
              @change="toggleAll"
              class="h-4 w-4 rounded border-gray-300 accent-indigo-600 dark:border-gray-600 dark:bg-gray-700"
            />
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              全选 / 取消全选
            </span>
          </label>
        </div>

        <!-- 平台列表 -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div
            v-for="platform in platformsStore.platforms"
            :key="platform.id"
            class="flex items-center justify-between rounded-md border p-3 transition-colors"
            :class="userPlatformConfigsStore.isEnabled(platform.slug)
              ? 'border-indigo-500 bg-indigo-50/30 dark:border-indigo-500 dark:bg-indigo-900/20'
              : 'border-gray-200 hover:border-indigo-300 dark:border-gray-700 dark:hover:border-indigo-500'"
          >
            <label class="flex flex-1 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                :checked="userPlatformConfigsStore.isEnabled(platform.slug)"
                @change="handleToggle(platform.slug)"
                class="h-4 w-4 rounded border-gray-300 accent-indigo-600 dark:border-gray-600 dark:bg-gray-700"
              />
              <img
                v-if="getFavicon(platform)"
                :src="getFavicon(platform)"
                :alt="platform.name"
                class="h-5 w-5 object-contain"
                @error="$event.target.style.display = 'none'"
              />
              <span v-else class="text-lg leading-none">🌐</span>
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200">
                {{ platform.name }}
              </span>
            </label>

            <!-- 打开平台页面 -->
            <a
              v-if="getPlatformUrl(platform)"
              :href="getPlatformUrl(platform)"
              target="_blank"
              rel="noopener noreferrer"
              class="ml-1 flex-shrink-0 text-gray-300 hover:text-indigo-500 dark:text-gray-600 dark:hover:text-indigo-400 transition-colors"
              title="打开平台页面"
              @click.stop
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zm7.25-.75a.75.75 0 01.75-.75h3.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V6.31l-5.22 5.22a.75.75 0 11-1.06-1.06l5.22-5.22H12.25a.75.75 0 01-.75-.75z" clip-rule="evenodd" />
              </svg>
            </a>

            <!-- 默认发布配置按钮 -->
            <button
              v-if="hasPlatformFields(platform.slug)"
              class="ml-2 flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700 dark:hover:text-indigo-400"
              title="配置默认发布选项"
              @click.stop="openConfig(platform)"
            >
              ⚙️
            </button>
          </div>
        </div>

        <!-- 底部操作按钮 -->
        <div class="mt-8 flex justify-end gap-3 border-t border-gray-100 pt-5 dark:border-gray-700">
          <button
            @click="resetPlatforms"
            class="rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
          >
            重置
          </button>
          <button
            @click="saveSettings"
            class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 默认发布配置 Modal -->
  <PlatformConfigModal
    v-if="configModal.visible"
    :slug="configModal.slug"
    :platform-name="configModal.name"
    :visible="configModal.visible"
    :save-to-backend="true"
    @close="configModal.visible = false"
    @saved="configModal.visible = false"
  />
</template>

<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import PlatformConfigModal from "../components/PlatformConfigModal.vue";
import { PLATFORM_FIELDS } from "../config/platformFields.js";
import { usePlatformsStore } from "../stores/platforms";
import { useUserPlatformConfigsStore } from "../stores/userPlatformConfigs.js";

const platformsStore = usePlatformsStore();
const userPlatformConfigsStore = useUserPlatformConfigsStore();
const checkingLogin = ref(false);
const loginCheckResult = ref(null);
const configModal = reactive({ visible: false, slug: "", name: "" });

function hasPlatformFields(slug) {
  return (PLATFORM_FIELDS[slug] || []).length > 0;
}

function openConfig(platform) {
  configModal.slug = platform.slug;
  configModal.name = platform.name;
  configModal.visible = true;
}

// Per-platform homepage overrides for the card "open in new tab" link.
// new_article_url is the editor entry (used by the extension to open publish
// tabs); some platforms expose a friendlier landing page for users.
const PLATFORM_HOMEPAGE_OVERRIDES = {
  "tencent-cloud": "https://cloud.tencent.com/developer/",
};

function getPlatformUrl(platform) {
  return PLATFORM_HOMEPAGE_OVERRIDES[platform.slug] || platform.new_article_url || null;
}

async function handleToggle(slug) {
  try {
    await userPlatformConfigsStore.toggleEnabled(slug);
  } catch (e) {
    window.$toast?.("切换平台状态失败: " + (e?.message || "未知错误"), "error");
  }
}

function getFavicon(platform) {
  const url = platform.new_article_url;
  if (!url) return null;
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return null;
  }
}

const allEnabled = computed(() => {
  if (!platformsStore.platforms.length) return false;
  return platformsStore.platforms.every(p => userPlatformConfigsStore.isEnabled(p.slug));
});

async function toggleAll(e) {
  const isChecked = e.target.checked;
  try {
    const promises = platformsStore.platforms
      .filter(p => userPlatformConfigsStore.isEnabled(p.slug) !== isChecked)
      .map(p => userPlatformConfigsStore.toggleEnabled(p.slug));
    await Promise.all(promises);
  } catch (err) {
    console.error("[Settings] toggleAll failed:", err);
    if (window.$toast) {
      window.$toast("批量切换失败，请重试", "error");
    }
  }
}

function resetPlatforms() {
  platformsStore.platforms.forEach(p => {
    if (userPlatformConfigsStore.isEnabled(p.slug)) {
      userPlatformConfigsStore.toggleEnabled(p.slug);
    }
  });
}

function saveSettings() {
  if (window.$toast) {
    window.$toast('设置已保存', 'success');
  }
}

onMounted(async () => {
  await platformsStore.loadPlatforms();
  await userPlatformConfigsStore.loadAll();
});

async function checkLoginStatus() {
  if (checkingLogin.value) return;

  const enabledPlatforms = platformsStore.selectedPlatforms;

  if (enabledPlatforms.length === 0) {
    loginCheckResult.value = {
      type: "error",
      message: "请先启用至少一个平台",
    };
    return;
  }

  checkingLogin.value = true;
  loginCheckResult.value = null;

  try {
    const result = await new Promise((resolve, reject) => {
      const handler = (e) => {
        clearTimeout(timer);
        resolve(e.detail);
      };
      const timer = setTimeout(() => {
        window.removeEventListener("omnipub:check-login-result", handler);
        reject(new Error("no_extension"));
      }, 5000);

      window.addEventListener("omnipub:check-login-result", handler, { once: true });

      window.dispatchEvent(
        new CustomEvent("omnipub:check-login", {
          detail: {
            platforms: enabledPlatforms.map((p) => ({
              slug: p.slug,
              name: p.name,
              new_article_url: p.new_article_url,
            })),
          },
        })
      );
    });

    const allResults = result?.results || [];
    const notLoggedIn = allResults.filter((r) => !r.loggedIn);
    const loggedIn = allResults.filter((r) => r.loggedIn);

    if (allResults.length === 0) {
      loginCheckResult.value = {
        type: "error",
        message: "未收到检测结果，请确认扩展已安装并刷新页面后重试",
      };
    } else if (notLoggedIn.length === 0) {
      loginCheckResult.value = {
        type: "success",
        message: `所有平台登录状态正常 ✅（共 ${allResults.length} 个平台）`,
        platforms: loggedIn,  // 显示所有通过的平台
      };
    } else {
      loginCheckResult.value = {
        type: "error",
        message: `${notLoggedIn.length} 个平台未登录，请前往平台登录：`,
        platforms: notLoggedIn,
        loggedInPlatforms: loggedIn,
      };
    }
  } catch (e) {
    loginCheckResult.value = {
      type: "error",
      message: e.message === "no_extension" ? "请先安装 Omnipub 扩展" : `检测失败：${e.message}`,
    };
  } finally {
    checkingLogin.value = false;
  }
}
</script>
