import api from "./index.js";

export const listUserPlatformConfigs = () => api.get("/user/platform-configs");
export const getUserPlatformConfig = (slug) => api.get(`/user/platform-configs/${slug}`);
export const upsertUserPlatformConfig = (slug, publish_config, enabled) =>
  api.put(`/user/platform-configs/${slug}`, { publish_config, enabled });
export const togglePlatformEnabled = (slug) =>
  api.patch(`/user/platform-configs/${slug}/toggle`);
