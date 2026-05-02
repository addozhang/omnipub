import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  listUserPlatformConfigs,
  getUserPlatformConfig,
  upsertUserPlatformConfig,
  togglePlatformEnabled,
} from "../api/userPlatformConfigs.js";

export const useUserPlatformConfigsStore = defineStore("userPlatformConfigs", () => {
  /** slug → publish_config dict */
  const configs = ref({});
  /** slug → boolean */
  const enabled = ref({});

  const enabledSlugs = computed(() =>
    Object.entries(enabled.value)
      .filter(([, v]) => v)
      .map(([slug]) => slug),
  );

  function isEnabled(slug) {
    return !!enabled.value[slug];
  }

  async function loadAll() {
    try {
      const res = await listUserPlatformConfigs();
      // res.data is a dict: { slug: { platform_slug, publish_config, enabled, updated_at } }
      const data = res.data || {};
      for (const [slug, item] of Object.entries(data)) {
        configs.value[slug] = item.publish_config || {};
        enabled.value[slug] = !!item.enabled;
      }
    } catch (e) {
      console.warn("[userPlatformConfigs] loadAll failed:", e);
    }
  }

  async function load(slug) {
    try {
      const res = await getUserPlatformConfig(slug);
      configs.value[slug] = res.data?.publish_config || {};
      enabled.value[slug] = !!res.data?.enabled;
    } catch (e) {
      console.warn(`[userPlatformConfigs] load(${slug}) failed:`, e);
    }
  }

  async function save(slug, config) {
    await upsertUserPlatformConfig(slug, config);
    configs.value[slug] = config;
  }

  async function toggleEnabled(slug) {
    // F-3: Do NOT apply an optimistic update.
    //
    // The backend toggle is atomic ("1 - enabled"), but if two browser tabs
    // call toggleEnabled(slug) concurrently they would both flip the same bit:
    //   Tab A optimistic: false → true   (server: true → false)
    //   Tab B optimistic: false → true   (server: false → true)
    // Both tabs end up showing "true" but the server ended up at "true" having
    // done two flips — net no-change but UI wrong for one tab.
    //
    // Without an optimistic update the UI simply waits for the server's
    // authoritative response, which is always correct.
    try {
      const res = await togglePlatformEnabled(slug);
      enabled.value[slug] = !!res.data?.enabled;
    } catch (e) {
      console.warn(`[userPlatformConfigs] toggleEnabled(${slug}) failed:`, e);
      throw e; // let callers show an error toast
    }
  }

  return { configs, enabled, enabledSlugs, isEnabled, loadAll, load, save, toggleEnabled };
});
