import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import ArticlePublish from "../../src/views/ArticlePublish.vue";
import { usePlatformsStore } from "../../src/stores/platforms";
import { useUserPlatformConfigsStore } from "../../src/stores/userPlatformConfigs";

// Mock vue-router
vi.mock("vue-router", () => ({
  useRoute: vi.fn(() => ({ params: { id: "1" } })),
  onBeforeRouteLeave: vi.fn(),
  RouterLink: {
    template: '<a><slot /></a>',
    props: ['to'],
  },
}));

// Mock API modules
vi.mock("../../src/api/platforms", () => ({
  getPlatforms: vi.fn(),
}));

vi.mock("../../src/api/userPlatformConfigs", () => ({
  listUserPlatformConfigs: vi.fn(),
  getUserPlatformConfig: vi.fn(),
  upsertUserPlatformConfig: vi.fn(),
  togglePlatformEnabled: vi.fn(),
}));

vi.mock("../../src/api/publications", () => ({
  publishArticle: vi.fn(),
  reportPublishResult: vi.fn(),
  getArticlePublications: vi.fn(),
}));

vi.mock("../../src/stores/articles", () => ({
  useArticlesStore: vi.fn(() => ({
    loadArticle: vi.fn().mockResolvedValue({ id: 1, title: "Test Article", markdown_content: "# Test" }),
  })),
}));

vi.mock("../../src/composables/useExtension", () => ({
  useExtension: vi.fn(() => ({
    isInstalled: { value: true },
  })),
}));

vi.mock("../../src/composables/usePublish", () => ({
  usePublish: vi.fn(() => ({
    startPublish: vi.fn(),
    platformStatuses: { value: {} },
    stopListening: vi.fn(),
  })),
}));

import { getPlatforms } from "../../src/api/platforms";
import { listUserPlatformConfigs } from "../../src/api/userPlatformConfigs";
import { getArticlePublications } from "../../src/api/publications";

const fakePlatforms = [
  { id: 1, name: "掘金", slug: "juejin", status: "active", new_article_url: "https://juejin.cn/editor" },
  { id: 2, name: "CSDN", slug: "csdn", status: "active", new_article_url: "https://csdn.net/editor" },
  { id: 3, name: "知乎", slug: "zhihu", status: "active", new_article_url: "https://zhuanlan.zhihu.com/write" },
];

describe("ArticlePublish.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    getPlatforms.mockResolvedValue({ success: true, data: fakePlatforms });
    listUserPlatformConfigs.mockResolvedValue({ success: true, data: {} });
    getArticlePublications.mockResolvedValue({ success: true, data: [] });
  });

  async function mountPublish(enabledSlugs = {}) {
    // Pre-configure enabled state before mounting
    const upcStore = useUserPlatformConfigsStore();
    upcStore.enabled = enabledSlugs;

    const wrapper = mount(ArticlePublish, {
      global: {
        stubs: {
          PlatformConfigModal: true,
          RouterLink: {
            template: '<a><slot /></a>',
            props: ['to'],
          },
        },
      },
    });
    await flushPromises();
    return wrapper;
  }

  it("only shows platforms with isEnabled=true", async () => {
    const wrapper = await mountPublish({ juejin: true, csdn: false, zhihu: true });

    // Should show 掘金 and 知乎 but not CSDN
    expect(wrapper.text()).toContain("掘金");
    expect(wrapper.text()).toContain("知乎");
    expect(wrapper.text()).not.toContain("CSDN");
  });

  it("shows empty state message when no platforms are enabled", async () => {
    const wrapper = await mountPublish({});

    expect(wrapper.text()).toContain("暂无已启用的平台");
    expect(wrapper.text()).toContain("设置");
  });

  it("shows all platforms when all are enabled", async () => {
    const wrapper = await mountPublish({ juejin: true, csdn: true, zhihu: true });

    expect(wrapper.text()).toContain("掘金");
    expect(wrapper.text()).toContain("CSDN");
    expect(wrapper.text()).toContain("知乎");
    expect(wrapper.text()).not.toContain("暂无已启用的平台");
  });

  it("disables publish button when no platforms are enabled", async () => {
    const wrapper = await mountPublish({});

    const buttons = wrapper.findAll("button");
    const publishButton = buttons.find((b) => b.text().includes("所有渠道已发布"));
    expect(publishButton).toBeTruthy();
    expect(publishButton.attributes("disabled")).toBeDefined();
  });
});
