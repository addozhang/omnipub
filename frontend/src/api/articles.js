import api from "./index";

export function getArticles(skip = 0, limit = 20) {
  return api.get("/articles", { params: { skip, limit } });
}

export function getArticle(id) {
  return api.get(`/articles/${id}`);
}

export function createArticle(data) {
  return api.post("/articles", data);
}

export function updateArticle(id, data) {
  return api.put(`/articles/${id}`, data);
}

export function deleteArticle(id) {
  return api.delete(`/articles/${id}`);
}
