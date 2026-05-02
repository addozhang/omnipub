<template>
  <div class="mx-auto max-w-4xl">
    <!-- 文章预览 -->
    <div class="mb-6">
      <router-link
        to="/articles"
        class="text-sm text-indigo-500 hover:text-indigo-600"
        >← 返回文章列表</router-link
      >
      <h1 class="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
        发布文章：{{ article?.title || "加载中..." }}
      </h1>
    </div>

    <!-- Chrome 扩展检测 -->
    <div
      v-if="!extensionInstalled"
      class="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-600 dark:bg-yellow-900/30"
    >
      <p class="text-sm text-yellow-700 dark:text-yellow-300">
        ⚠️ 未检测到 Omnipub Chrome 扩展。请先安装扩展以使用发布功能。
      </p>
    </div>

    <!-- 已启用的平台列表 -->
    <div class="mb-6">
      <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
        发布目标平台
      </h2>
      <div v-if="platforms.length === 0" class="text-sm text-gray-400">
        暂无已启用的平台，请先在<router-link to="/settings" class="text-indigo-500 hover:underline ml-1">设置</router-link>中配置平台。
      </div>
      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div
          v-for="platform in platforms"
          :key="platform.id"
          class="flex items-center gap-2 rounded-lg border p-3 transition-colors"
          :class="platformCardClass(platform.slug)"
          @click="publishedSlugs.has(platform.slug) ? toggleRepublish(platform.slug) : null"
        >
          <span
            class="text-sm font-medium"
            :class="publishedSlugs.has(platform.slug) && !republishSlugs.has(platform.slug)
              ? 'text-gray-400 dark:text-gray-500'
              : 'text-gray-700 dark:text-gray-300'"
          >
            {{ platform.name }}
          </span>
          <!-- 已发布徽章 -->
          <span
            v-if="publishedSlugs.has(platform.slug) && !republishSlugs.has(platform.slug)"
            class="ml-auto inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400"
          >
            ✓ 已发布
          </span>
          <!-- 重新发布徽章 -->
          <span
            v-else-if="republishSlugs.has(platform.slug)"
            class="ml-auto inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400"
          >
            🔄 重新发布
          </span>
          <template v-else>
            <!-- 已有覆盖配置时显示蓝点 -->
            <span
              v-if="publishOverrides[platform.slug] && Object.keys(publishOverrides[platform.slug]).length"
              class="ml-1 h-1.5 w-1.5 rounded-full bg-indigo-500"
              title="已设置本次覆盖配置"
            ></span>
            <button
              v-if="hasPlatformFields(platform.slug)"
              @click.stop="openConfig(platform)"
              class="ml-auto text-gray-400 hover:text-indigo-500 text-xs"
              title="调整本次发布配置"
            >⚙️</button>
          </template>
        </div>
      </div>

      <!-- 平台配置 Modal（本次覆盖，不保存后端） -->
      <PlatformConfigModal
        v-if="configModal.visible"
        :slug="configModal.slug"
        :platform-name="configModal.name"
        :visible="configModal.visible"
        :save-to-backend="false"
        :override-config="publishOverrides[configModal.slug] || {}"
        @close="configModal.visible = false"
        @saved="configModal.visible = false"
        @override="applyOverride"
      />
    </div>

    <!-- 实时发布进度 -->
    <div v-if="publishing || hasProgress" class="mb-6">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          发布进度
        </h2>
        <!-- H-U2: 倒计时显示 -->
        <span v-if="publishing && countdown > 0" class="text-xs text-gray-400">
          超时倒计时 {{ Math.floor(countdown / 60) }}:{{ String(countdown % 60).padStart(2, '0') }}
        </span>
      </div>
      <div class="space-y-2">
        <div
          v-for="status in progressList"
          :key="status.platformSlug"
          class="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
        >
          <!-- 状态指示点 -->
          <span
            class="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            :class="statusDotClass(status.status)"
          ></span>
          <!-- 旋转图标（发布中） -->
          <svg
            v-if="status.status === 'filling' || status.status === 'publishing'"
            class="h-4 w-4 animate-spin text-indigo-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ status.platformName }}
          </span>
          <span class="ml-auto text-sm text-gray-400">
            {{ statusText(status.status) }}
          </span>
          <!-- U-C1: 失败平台的链接和重试按钮 -->
          <template v-if="status.status === 'failed'">
            <button
              class="rounded px-2 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
              @click="retryPlatform(status.platformSlug)"
              :disabled="publishing"
            >
              重试
            </button>
          </template>
          <!-- 成功平台显示链接 -->
          <a
            v-if="status.status === 'success' && status.article_url"
            :href="status.article_url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-indigo-500 hover:text-indigo-600 dark:text-indigo-400"
          >
            查看 ↗
          </a>
          <span v-else-if="status.message && status.status !== 'failed'" class="text-xs text-gray-400">
            {{ status.message }}
          </span>
        </div>
      </div>

      <!-- H-U3: 发布完成后汇总 -->
      <div
        v-if="publishSummary"
        class="mt-4 rounded-lg border p-4"
        :class="publishSummary.failed === 0
          ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
          : 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20'"
      >
        <div class="flex items-center gap-2 text-sm font-medium"
          :class="publishSummary.failed === 0 ? 'text-green-700 dark:text-green-400' : 'text-yellow-700 dark:text-yellow-400'"
        >
          <span>{{ publishSummary.failed === 0 ? '🎉' : '⚠️' }}</span>
          <span>发布完成：{{ publishSummary.success }} 个成功<span v-if="publishSummary.failed > 0">，{{ publishSummary.failed }} 个失败</span></span>
        </div>
        <div v-if="publishSummary.successPlatforms.length > 0" class="mt-2 flex flex-wrap gap-2">
          <template v-for="p in publishSummary.successPlatforms" :key="p.slug">
            <a
              v-if="p.url"
              :href="p.url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:shadow dark:bg-gray-800 dark:text-gray-300"
            >
              {{ p.name }} <span class="text-indigo-500">↗</span>
            </a>
          </template>
        </div>
      </div>
    </div>

    <!-- 发布按钮 -->
    <div class="flex items-center gap-3">
      <button
        :disabled="targetPlatforms.length === 0 || publishing || !extensionInstalled"
        class="rounded-lg bg-indigo-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
        @click="handlePublish"
      >
        {{ publishing ? "发布中..." : targetPlatforms.length === 0 ? "所有渠道已发布" : `一键发布到 ${targetPlatforms.length} 个渠道` }}
      </button>
      <span v-if="publishedSlugs.size > 0 && unpublishedPlatforms.length > 0 && republishSlugs.size === 0" class="text-xs text-gray-400">
        {{ publishedSlugs.size }} 个渠道已发布，点击可重新发布
      </span>
      <span v-else-if="republishSlugs.size > 0" class="text-xs text-indigo-500">
        含 {{ republishSlugs.size }} 个重新发布
      </span>
      <!-- 自动关闭标签页开关 -->
      <label class="ml-auto flex cursor-pointer items-center gap-2">
        <div
          class="relative h-5 w-9 rounded-full transition-colors"
          :class="autoCloseTabs ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'"
          @click="autoCloseTabs = !autoCloseTabs"
        >
          <div
            class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
            :class="autoCloseTabs ? 'translate-x-4' : 'translate-x-0.5'"
          ></div>
        </div>
        <span class="text-sm text-gray-600 dark:text-gray-400">发布后自动关闭标签页</span>
      </label>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from "vue";
import { useRoute, onBeforeRouteLeave } from "vue-router";
import { useArticlesStore } from "../stores/articles";
import { usePlatformsStore } from "../stores/platforms";
import { publishArticle, getArticlePublications } from "../api/publications";
import { useExtension } from "../composables/useExtension";
import { usePublish } from "../composables/usePublish";
import { useUserPlatformConfigsStore } from "../stores/userPlatformConfigs";
import { PLATFORM_FIELDS } from "../config/platformFields";
import PlatformConfigModal from "../components/PlatformConfigModal.vue";

const route = useRoute();
const articlesStore = useArticlesStore();
const platformsStore = usePlatformsStore();
const userPlatformConfigsStore = useUserPlatformConfigsStore();
const { isInstalled: extensionInstalled } = useExtension();
const { startPublish, platformStatuses } = usePublish();

// Config modal state
const configModal = reactive({ visible: false, slug: "", name: "" });
// 本次发布的临时覆盖配置（不持久化）
const publishOverrides = reactive({});

function hasPlatformFields(slug) {
  return !!(PLATFORM_FIELDS[slug]?.length);
}
function openConfig(platform) {
  configModal.slug = platform.slug;
  configModal.name = platform.name;
  configModal.visible = true;
}
function applyOverride({ slug, config }) {
  publishOverrides[slug] = config;
}

function buildMergedConfig(slug) {
  const base = { ...(userPlatformConfigsStore.configs[slug] || {}), ...(publishOverrides[slug] || {}) };
  if (!article.value) return base;
  const fields = PLATFORM_FIELDS[slug] || [];
  const fieldKeys = new Set(fields.map(f => f.key));
  if (fieldKeys.has("category") && article.value.category) {
    base.category = article.value.category;
  }
  if (fieldKeys.has("tags") && article.value.tags) {
    const raw = article.value.tags;
    base.tags = Array.isArray(raw) ? raw : String(raw).split(",").map(s => s.trim()).filter(Boolean);
  }
  if (fieldKeys.has("summary") && article.value.summary) {
    base.summary = article.value.summary;
  }
  return base;
}

const article = ref(null);
const platforms = ref([]);
const publishing = ref(false);
const publishedSlugs = ref(new Set()); // 已成功发布的平台 slugs
const republishSlugs = ref(new Set()); // 用户选中要重新发布的已发布平台
const autoCloseTabs = ref(true); // 发布后是否自动关闭标签页
const countdown = ref(0); // H-U2: 超时倒计时（秒）
const publishSummary = ref(null); // H-U3: 发布完成汇总
let publishTimeoutId = null;
let countdownIntervalId = null;

// U-C2: Prevent navigation while publish is in progress
onBeforeRouteLeave((_to, _from, next) => {
  if (publishing.value) {
    const leave = window.confirm("发布正在进行中，离开页面可能导致发布中断。确认离开？");
    next(leave);
  } else {
    next();
  }
});

function handleBeforeUnload(e) {
  if (publishing.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}
window.addEventListener("beforeunload", handleBeforeUnload);
onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  if (publishTimeoutId) {
    clearTimeout(publishTimeoutId);
    publishTimeoutId = null;
  }
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
});

const progressList = computed(() => Object.values(platformStatuses.value));
const hasProgress = computed(() => progressList.value.length > 0);

// 未成功发布的平台（本次可发布的目标）
const unpublishedPlatforms = computed(() =>
  platforms.value.filter(p => !publishedSlugs.value.has(p.slug))
);

// 最终发布目标 = 未发布 + 勾选的重新发布
const targetPlatforms = computed(() => {
  const republish = platforms.value.filter(p => republishSlugs.value.has(p.slug));
  return [...unpublishedPlatforms.value, ...republish];
});

function toggleRepublish(slug) {
  const next = new Set(republishSlugs.value);
  if (next.has(slug)) {
    next.delete(slug);
  } else {
    next.add(slug);
  }
  republishSlugs.value = next;
}

function platformCardClass(slug) {
  if (republishSlugs.value.has(slug)) {
    return 'border-indigo-400 bg-indigo-50/50 cursor-pointer dark:border-indigo-500 dark:bg-indigo-900/20';
  }
  if (publishedSlugs.value.has(slug)) {
    return 'border-gray-100 bg-gray-50 opacity-60 cursor-pointer dark:border-gray-800 dark:bg-gray-900/40';
  }
  return 'border-gray-200 dark:border-gray-700';
}

onMounted(async () => {
  const id = Number(route.params.id);
  try {
    article.value = await articlesStore.loadArticle(id);
  } catch {
    window.$toast?.("加载文章失败", "error");
    return;
  }

  await platformsStore.loadPlatforms();
  await userPlatformConfigsStore.loadAll();
  // 只显示已启用的平台
  platforms.value = platformsStore.platforms.filter((p) => userPlatformConfigsStore.isEnabled(p.slug));

  // 获取已有发布记录，标记已成功发布的渠道
  try {
    const pubResp = await getArticlePublications(id);
    const pubs = pubResp.data || [];
    const successSlugs = new Set();
    for (const pub of pubs) {
      const status = (pub.status || "").toLowerCase();
      if (status === "published" || status === "success") {
        successSlugs.add(pub.platform_slug);
      }
    }
    publishedSlugs.value = successSlugs;
  } catch {
    // 获取发布记录失败不阻塞，继续正常流程
  }
});

// H-U2: Countdown timer helpers
const PUBLISH_TIMEOUT_MS = 120000;
function startCountdown() {
  countdown.value = Math.floor(PUBLISH_TIMEOUT_MS / 1000);
  countdownIntervalId = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      stopCountdown();
    }
  }, 1000);
}
function stopCountdown() {
  countdown.value = 0;
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
}

// H-U3: Build publish summary from final statuses
function buildSummary() {
  const statuses = Object.values(platformStatuses.value);
  const successPlatforms = statuses
    .filter(s => s.status === "success")
    .map(s => ({ slug: s.platformSlug, name: s.platformName, url: s.article_url }));
  const failedPlatforms = statuses
    .filter(s => s.status === "failed")
    .map(s => ({ slug: s.platformSlug, name: s.platformName }));
  publishSummary.value = {
    success: successPlatforms.length,
    failed: failedPlatforms.length,
    successPlatforms,
    failedPlatforms,
  };
}

// U-C1: Retry failed platform
async function retryPlatform(slug) {
  if (!article.value || publishing.value) return;
  const platform = platforms.value.find(p => p.slug === slug);
  if (!platform) return;

  publishing.value = true;
  publishSummary.value = null; // Clear previous summary
  startCountdown();

  try {
    // Create a new publication record for this single platform
    const pubResp = await publishArticle(article.value.id, [platform.id]);
    const publications = pubResp.data || [];
    const pubIdByPlatformId = {};
    for (const pub of publications) {
      pubIdByPlatformId[pub.platform_id] = pub.id;
    }

    const mergedConfigs = {};
    const publicationIds = {};
    mergedConfigs[slug] = buildMergedConfig(slug);
    if (pubIdByPlatformId[platform.id]) {
      publicationIds[slug] = pubIdByPlatformId[platform.id];
    }

    const result = await startPublish(article.value, [platform], autoCloseTabs.value, () => {
      const statuses = Object.values(platformStatuses.value);
      const done = statuses.every(
        (s) => s.status === "success" || s.status === "failed"
      );
      if (done) {
        publishing.value = false;
        stopCountdown();
        if (publishTimeoutId) {
          clearTimeout(publishTimeoutId);
          publishTimeoutId = null;
        }
        // Update published slugs
        const newPublished = new Set(publishedSlugs.value);
        for (const s of statuses) {
          if (s.status === "success") {
            newPublished.add(s.platformSlug);
          }
        }
        publishedSlugs.value = newPublished;
        buildSummary();
      }
    }, mergedConfigs, publicationIds);

    if (!result.ok) {
      window.$toast?.(result.error, "error");
      publishing.value = false;
      stopCountdown();
      return;
    }

    publishTimeoutId = setTimeout(() => {
      publishing.value = false;
      publishTimeoutId = null;
      stopCountdown();
      window.$toast?.("发布超时，请确认扩展是否正常运行", "error");
    }, PUBLISH_TIMEOUT_MS);
  } catch {
    window.$toast?.("重试失败", "error");
    stopCountdown();
    if (publishTimeoutId) {
      clearTimeout(publishTimeoutId);
      publishTimeoutId = null;
    }
    publishing.value = false;
  }
}

async function handlePublish() {
  // H-U1: Explicit double-click guard (belt-and-suspenders with :disabled)
  if (!article.value || targetPlatforms.value.length === 0 || publishing.value) return;
  publishing.value = true;
  publishSummary.value = null; // Clear previous summary
  if (publishTimeoutId) {
    clearTimeout(publishTimeoutId);
    publishTimeoutId = null;
  }
  startCountdown(); // H-U2: Start countdown

  const currentTargets = targetPlatforms.value;

  try {
    // 1. 创建发布记录（后端），获取 publication_id 用于结果上报
    const platformIds = currentTargets.map((p) => p.id);
    const pubResp = await publishArticle(article.value.id, platformIds);
    const publications = pubResp.data || [];
    // 建立 platform_id → publication_id 的映射
    const pubIdByPlatformId = {};
    for (const pub of publications) {
      pubIdByPlatformId[pub.platform_id] = pub.id;
    }

    // 2. 启动后台发布：合并默认配置 + 本次覆盖 + publication_id
    const mergedConfigs = {};
    const publicationIds = {};
    for (const p of currentTargets) {
      mergedConfigs[p.slug] = buildMergedConfig(p.slug);
      if (pubIdByPlatformId[p.id]) {
        publicationIds[p.slug] = pubIdByPlatformId[p.id];
      }
    }
    const result = await startPublish(article.value, currentTargets, autoCloseTabs.value, () => {
      // 检查是否全部完成
      const statuses = Object.values(platformStatuses.value);
      const done = statuses.every(
        (s) => s.status === "success" || s.status === "failed"
      );
      if (done && statuses.length === currentTargets.length) {
        publishing.value = false;
        stopCountdown(); // H-U2: Stop countdown
        if (publishTimeoutId) {
          clearTimeout(publishTimeoutId);
          publishTimeoutId = null;
        }
        // 把本次成功发布的渠道加入已发布集合
        const newPublished = new Set(publishedSlugs.value);
        for (const s of statuses) {
          if (s.status === "success") {
            newPublished.add(s.platformSlug);
          }
        }
        publishedSlugs.value = newPublished;
        // 清空重新发布选择
        republishSlugs.value = new Set();

        // H-U3: Build summary
        buildSummary();

        const failed = statuses.filter((s) => s.status === "failed").length;
        if (failed === 0) {
          window.$toast?.("所有平台发布完成 🎉");
        } else {
          window.$toast?.(`发布完成，${failed} 个平台失败`, "warning");
        }
      }
    }, mergedConfigs, publicationIds);

    if (!result.ok) {
      window.$toast?.(result.error, "error");
      publishing.value = false;
      stopCountdown();
      return;
    }

    publishTimeoutId = setTimeout(() => {
      publishing.value = false;
      publishTimeoutId = null;
      stopCountdown(); // H-U2: Stop countdown
      window.$toast?.("发布超时，请确认扩展是否正常运行", "error");
    }, PUBLISH_TIMEOUT_MS);
  } catch {
    window.$toast?.("发布失败", "error");
    stopCountdown(); // H-U2: Stop countdown
    if (publishTimeoutId) {
      clearTimeout(publishTimeoutId);
      publishTimeoutId = null;
    }
    publishing.value = false;
  }
}

function statusDotClass(status) {
  const map = {
    pending: "bg-gray-400",
    filling: "bg-blue-400",
    publishing: "bg-indigo-500",
    success: "bg-green-500",
    failed: "bg-red-500",
  };
  return map[status] || "bg-gray-400";
}

function statusText(status) {
  const map = {
    pending: "等待中",
    filling: "填充内容中...",
    publishing: "发布中...",
    success: "发布成功 ✓",
    failed: "发布失败 ✗",
  };
  return map[status] || status;
}
</script>
