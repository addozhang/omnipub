/**
 * useExtension — 检测 Omnipub Chrome 扩展是否安装及版本
 *
 * 全局单例：状态在所有组件间共享，只检测一次。
 */

import { ref, computed } from "vue";

const status = ref("checking");
const installedVersion = ref(null);
const latestVersion = ref(null);

let initialized = false;

async function fetchLatestVersion() {
  try {
    const res = await fetch("/api/extension/version");
    if (res.ok) {
      const json = await res.json();
      return json.data?.version || null;
    }
  } catch {}
  return null;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

async function check() {
  status.value = "checking";
  latestVersion.value = await fetchLatestVersion();

  const detected = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2000);

    window.addEventListener(
      "omnipub:ready",
      (e) => {
        clearTimeout(timer);
        resolve(e.detail);
      },
      { once: true }
    );

    window.dispatchEvent(new CustomEvent("omnipub:ping"));
  });

  if (!detected) {
    status.value = "not-installed";
    return;
  }

  installedVersion.value = detected.version;

  if (
    latestVersion.value &&
    compareVersions(detected.version, latestVersion.value) < 0
  ) {
    status.value = "outdated";
  } else {
    status.value = "installed";
  }
}

// 页面加载时立即检测一次（监听 content script 的主动 ready 事件）
window.addEventListener("omnipub:ready", (e) => {
  if (status.value === "checking" || status.value === "not-installed") {
    installedVersion.value = e.detail?.version || null;
    status.value = "installed";
  }
});

export function useExtension() {
  // 首次使用时触发检测
  if (!initialized) {
    initialized = true;
    check();
  }

  return {
    status,
    installedVersion,
    latestVersion,
    check,
    isInstalled: computed(() => status.value === "installed" || status.value === "outdated"),
  };
}
