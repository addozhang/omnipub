import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import UserSettings from "../../src/views/UserSettings.vue";

describe("UserSettings.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mountUserSettings() {
    return mount(UserSettings, {
      global: {
        stubs: {
          RouterLink: true,
          ChangePassword: { template: '<div class="change-password-stub" />' },
          ApiKeyManager: { template: '<div class="api-key-manager-stub" />' },
        },
      },
    });
  }

  it("renders page title and two tabs", () => {
    const wrapper = mountUserSettings();

    expect(wrapper.text()).toContain("用户设置");

    const buttons = wrapper.findAll("button");
    const labels = buttons.map((b) => b.text());
    expect(labels).toContain("修改密码");
    expect(labels).toContain("API 密钥");
  });

  it("shows ChangePassword component by default", () => {
    const wrapper = mountUserSettings();

    expect(wrapper.find(".change-password-stub").exists()).toBe(true);
    expect(wrapper.find(".api-key-manager-stub").exists()).toBe(false);
  });

  it("switches to API Keys tab when clicked", async () => {
    const wrapper = mountUserSettings();

    const buttons = wrapper.findAll("button");
    const apiKeysTab = buttons.find((b) => b.text() === "API 密钥");
    await apiKeysTab.trigger("click");

    expect(wrapper.find(".api-key-manager-stub").exists()).toBe(true);
    expect(wrapper.find(".change-password-stub").exists()).toBe(false);
  });

  it("switches back to password tab", async () => {
    const wrapper = mountUserSettings();

    const buttons = wrapper.findAll("button");
    const apiKeysTab = buttons.find((b) => b.text() === "API 密钥");
    await apiKeysTab.trigger("click");

    expect(wrapper.find(".api-key-manager-stub").exists()).toBe(true);

    const passwordTab = wrapper.findAll("button").find((b) => b.text() === "修改密码");
    await passwordTab.trigger("click");

    expect(wrapper.find(".change-password-stub").exists()).toBe(true);
    expect(wrapper.find(".api-key-manager-stub").exists()).toBe(false);
  });
});
