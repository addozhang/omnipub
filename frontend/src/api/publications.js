import api from "./index";

export function publishArticle(articleId, platformIds) {
  return api.post(`/articles/${articleId}/publish`, {
    platform_ids: platformIds,
  });
}

export function reportPublishResult(data) {
  return api.post("/articles/report-publish-result", data);
}

export function getArticlePublications(articleId) {
  return api.get(`/articles/${articleId}/publications`);
}

export function getPublicationsBatch(articleIds) {
  return api.get(`/publications/batch?article_ids=${articleIds.join(",")}`);
}
