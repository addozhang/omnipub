import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import ExtensionBanner from "@/components/ExtensionBanner.vue";

const mockStatus = ref("installed");
const mockInstalled = ref("1.0.0");
const mockLatest = ref("1.0.0");

vi.mock("@/composables/useExtension", () => ({
  useExtension: () => ({
    status: mockStatus,
    installedVersion: mockInstalled,
    latestVersion: mockLatest,
  }),
}));

describe("ExtensionBanner", () => {
  beforeEach(() => {
    mockStatus.value = "installed";
    mockInstalled.value = "1.0.0";
    mockLatest.value = "1.0.0";
  });

  it("renders nothing when installed", () => {
    const wrapper = mount(ExtensionBanner);
    expect(wrapper.text()).toBe("");
  });

  it("shows install message when not installed", () => {
    mockStatus.value = "not-installed";
    const wrapper = mount(ExtensionBanner);

    expect(wrapper.text()).toContain("未检测到 Omnipub 扩展");
    expect(wrapper.text()).toContain("去安装");
  });

  it("shows update message when outdated", () => {
    mockStatus.value = "outdated";
    mockInstalled.value = "0.9.0";
    mockLatest.value = "1.0.0";
    const wrapper = mount(ExtensionBanner);

    expect(wrapper.text()).toContain("版本");
    expect(wrapper.text()).toContain("v0.9.0");
    expect(wrapper.text()).toContain("v1.0.0");
    expect(wrapper.text()).toContain("去更新");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
