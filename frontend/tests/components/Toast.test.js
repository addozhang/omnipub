import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import Toast from "@/components/Toast.vue";

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("show() displays message and success styling", async () => {
    const wrapper = mount(Toast);

    wrapper.vm.show("Saved!");
    await nextTick();

    expect(wrapper.text()).toContain("Saved!");
    expect(wrapper.classes()).toContain("bg-green-500");
  });

  it("show() supports error and warning types", async () => {
    const wrapper = mount(Toast);

    wrapper.vm.show("Oops", "error");
    await nextTick();
    expect(wrapper.classes()).toContain("bg-red-500");

    wrapper.vm.show("Careful", "warning");
    await nextTick();
    expect(wrapper.classes()).toContain("bg-yellow-500");
  });

  it("hide() removes toast", async () => {
    const wrapper = mount(Toast);
    wrapper.vm.show("Hidden");
    await nextTick();

    wrapper.vm.hide();
    await nextTick();

    expect(wrapper.html()).toBe("<!--v-if-->");
  });

  it("auto-hides after duration", async () => {
    const wrapper = mount(Toast);
    wrapper.vm.show("Timed", "info", 1000);
    await nextTick();

    vi.advanceTimersByTime(1000);
    await nextTick();

    expect(wrapper.html()).toBe("<!--v-if-->");
  });
});
