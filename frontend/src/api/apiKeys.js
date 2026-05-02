import api from "./index";

export function listApiKeys() {
  return api.get("/api-keys");
}

export function createApiKey(name) {
  return api.post("/api-keys", { name });
}

export function regenerateApiKey(id) {
  return api.post(`/api-keys/${id}/regenerate`);
}

export function deleteApiKey(id) {
  return api.delete(`/api-keys/${id}`);
}
