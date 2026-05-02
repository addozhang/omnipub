import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ApiKeyModal from "../../src/components/ApiKeyModal.vue";

describe("ApiKeyModal.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create mode renders form with name input", () => {
    const wrapper = mount(ApiKeyModal, {
      props: { mode: "create" },
    });

    const input = wrapper.find('input[type="text"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes("placeholder")).toContain("CI/CD");
  });

  it("create mode emits created event on submit", async () => {
    const wrapper = mount(ApiKeyModal, {
      props: { mode: "create" },
    });

    await wrapper.find('input[type="text"]').setValue("My Key");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("created")).toBeTruthy();
    expect(wrapper.emitted("created")[0]).toEqual(["My Key"]);
  });

  it("create mode does not emit if name is empty", async () => {
    const wrapper = mount(ApiKeyModal, {
      props: { mode: "create" },
    });

    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("created")).toBeFalsy();
  });

  it("reveal mode shows key and copy button", () => {
    const wrapper = mount(ApiKeyModal, {
      props: {
        mode: "reveal",
        revealKey: "omnk_testkey123",
        revealTitle: "密钥已创建",
      },
    });

    expect(wrapper.text()).toContain("omnk_testkey123");
    expect(wrapper.text()).toContain("密钥已创建");

    const buttons = wrapper.findAll("button");
    const copyBtn = buttons.find((b) => b.text() === "复制");
    expect(copyBtn).toBeDefined();
  });

  it("reveal mode shows warning message", () => {
    const wrapper = mount(ApiKeyModal, {
      props: {
        mode: "reveal",
        revealKey: "omnk_testkey123",
        revealTitle: "密钥已创建",
      },
    });

    expect(wrapper.text()).toContain("请立即复制此密钥");
  });

  it("close button emits close in reveal mode", async () => {
    const wrapper = mount(ApiKeyModal, {
      props: {
        mode: "reveal",
        revealKey: "omnk_testkey123",
        revealTitle: "密钥已创建",
      },
    });

    const buttons = wrapper.findAll("button");
    const saveBtn = buttons.find((b) => b.text() === "我已保存密钥");
    await saveBtn.trigger("click");

    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("cancel button emits close in create mode", async () => {
    const wrapper = mount(ApiKeyModal, {
      props: { mode: "create" },
    });

    const buttons = wrapper.findAll("button");
    const cancelBtn = buttons.find((b) => b.text() === "取消");
    await cancelBtn.trigger("click");

    expect(wrapper.emitted("close")).toBeTruthy();
  });
});
