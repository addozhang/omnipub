import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../../src/api/apiKeys", () => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  regenerateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
}));

vi.mock("../../src/components/ApiKeyModal.vue", () => ({
  default: {
    template: '<div class="api-key-modal-stub" />',
    props: ["mode", "revealKey", "revealTitle"],
  },
}));

import {
  listApiKeys,
  createApiKey,
  regenerateApiKey,
  deleteApiKey,
} from "../../src/api/apiKeys";
import ApiKeyManager from "../../src/components/ApiKeyManager.vue";

const fakeKeys = [
  {
    id: 1,
    name: "CI Key",
    key_prefix: "omnk_abc123",
    created_at: "2026-01-01T00:00:00Z",
    last_used_at: "2026-01-02T00:00:00Z",
  },
  {
    id: 2,
    name: "Local Dev",
    key_prefix: "omnk_xyz789",
    created_at: "2026-01-03T00:00:00Z",
    last_used_at: null,
  },
];

describe("ApiKeyManager.vue", () => {
  let confirmSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it("shows loading state initially", () => {
    listApiKeys.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(ApiKeyManager);

    expect(wrapper.text()).toContain("加载中...");
  });

  it("shows empty state when no keys", async () => {
    listApiKeys.mockResolvedValue({ data: [] });
    const wrapper = mount(ApiKeyManager);
    await flushPromises();

    expect(wrapper.text()).toContain("暂无 API 密钥");
  });

  it("renders key list", async () => {
    listApiKeys.mockResolvedValue({ data: fakeKeys });
    const wrapper = mount(ApiKeyManager);
    await flushPromises();

    expect(wrapper.text()).toContain("CI Key");
    expect(wrapper.text()).toContain("Local Dev");
    expect(wrapper.text()).toContain("omnk_abc123");
  });

  it("shows supported API info", async () => {
    listApiKeys.mockResolvedValue({ data: [] });
    const wrapper = mount(ApiKeyManager);
    await flushPromises();

    expect(wrapper.text()).toContain("POST /api/articles");
    expect(wrapper.text()).toContain("创建文章");
  });

  it("shows usage instructions", async () => {
    listApiKeys.mockResolvedValue({ data: [] });
    const wrapper = mount(ApiKeyManager);
    await flushPromises();

    expect(wrapper.text()).toContain("Authorization: Bearer omnk_");
  });

  it("shows create button", async () => {
    listApiKeys.mockResolvedValue({ data: [] });
    const wrapper = mount(ApiKeyManager);
    await flushPromises();

    const buttons = wrapper.findAll("button");
    const createBtn = buttons.find((b) => b.text() === "创建密钥");
    expect(createBtn).toBeDefined();
  });

  it("delete button calls deleteApiKey after confirm", async () => {
    listApiKeys.mockResolvedValue({ data: fakeKeys });
    deleteApiKey.mockResolvedValue({});
    const wrapper = mount(ApiKeyManager);
    await flushPromises();

    const buttons = wrapper.findAll("button");
    const deleteBtn = buttons.find((b) => b.text() === "删除");
    await deleteBtn.trigger("click");
    await flushPromises();

    expect(deleteApiKey).toHaveBeenCalledWith(1);
  });

  it("regenerate button calls regenerateApiKey after confirm", async () => {
    listApiKeys.mockResolvedValue({ data: fakeKeys });
    regenerateApiKey.mockResolvedValue({ data: { key: "omnk_newkey123" } });
    const wrapper = mount(ApiKeyManager);
    await flushPromises();

    const buttons = wrapper.findAll("button");
    const regenBtn = buttons.find((b) => b.text() === "重新生成");
    await regenBtn.trigger("click");
    await flushPromises();

    expect(regenerateApiKey).toHaveBeenCalledWith(1);
  });
});
