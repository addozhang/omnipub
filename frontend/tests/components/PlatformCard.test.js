import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import PlatformCard from "@/components/PlatformCard.vue";

const basePlatform = {
  name: "掘金",
  status: "active",
  new_article_url: "https://juejin.cn/editor",
};

describe("PlatformCard", () => {
  let openSpy;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => {});
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it("renders platform name and status badge", () => {
    const wrapper = mount(PlatformCard, {
      props: { platform: basePlatform, selected: false },
    });

    expect(wrapper.text()).toContain("掘金");
    expect(wrapper.text()).toContain("正常");
    const dot = wrapper.find(".h-2");
    expect(dot.classes()).toContain("bg-green-500");
  });

  it("applies selected styles when selected", () => {
    const wrapper = mount(PlatformCard, {
      props: { platform: basePlatform, selected: true },
    });

    expect(wrapper.classes()).toContain("border-indigo-500");
    const checkbox = wrapper.find('input[type="checkbox"]');
    expect(checkbox.element.checked).toBe(true);
  });

  it("emits toggle when checkbox changes", async () => {
    const wrapper = mount(PlatformCard, {
      props: { platform: basePlatform, selected: false },
    });

    const checkbox = wrapper.find('input[type="checkbox"]');
    await checkbox.setChecked();

    expect(wrapper.emitted().toggle).toBeTruthy();
    expect(wrapper.emitted().toggle).toHaveLength(1);
  });

  it("opens login url when card is clicked", async () => {
    const wrapper = mount(PlatformCard, {
      props: { platform: basePlatform, selected: false },
    });

    await wrapper.trigger("click");

    expect(openSpy).toHaveBeenCalledWith("https://juejin.cn/editor", "_blank");
  });
});
