import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { getPlatforms as fetchPlatforms } from "../api/platforms";
import { useUserPlatformConfigsStore } from "./userPlatformConfigs";

export const usePlatformsStore = defineStore("platforms", () => {
  const platforms = ref([]);
  const loading = ref(false);

  const selectedPlatforms = computed(() => {
    const upcStore = useUserPlatformConfigsStore();
    return platforms.value.filter((p) => upcStore.isEnabled(p.slug));
  });

  async function loadPlatforms() {
    loading.value = true;
    try {
      const res = await fetchPlatforms();
      platforms.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  return {
    platforms,
    loading,
    selectedPlatforms,
    loadPlatforms,
  };
});
