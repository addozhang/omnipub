import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import Sidebar from "@/components/Sidebar.vue";

const routePath = ref("/");
const pushSpy = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushSpy }),
  useRoute: () => ({ path: routePath.value }),
}));

const mockLogout = vi.fn();
const mockUser = ref({ username: "alice", email: "a@test.com" });

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    user: mockUser.value,
    logout: mockLogout,
  }),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    routePath.value = "/";
    mockLogout.mockClear();
    pushSpy.mockClear();
  });

  it("renders navigation links", () => {
    const wrapper = mount(Sidebar, {
      global: {
        stubs: {
          "router-link": { template: "<a><slot /></a>", props: ["to"] },
        },
      },
    });

    const links = wrapper.findAll("a");
    expect(links.length).toBe(5);
    expect(wrapper.text()).toContain("仪表盘");
    expect(wrapper.text()).toContain("我的文章");
    expect(wrapper.text()).toContain("发布记录");
    expect(wrapper.text()).toContain("渠道设置");
  });

  it("logout button triggers store logout and navigates", async () => {
    const wrapper = mount(Sidebar, {
      global: {
        stubs: {
          "router-link": { template: "<a><slot /></a>", props: ["to"] },
        },
      },
    });

    await wrapper.find("button").trigger("click");

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith("/login");
  });

  it("applies active class to matching route", () => {
    routePath.value = "/articles/1";
    const wrapper = mount(Sidebar, {
      global: {
        stubs: {
          "router-link": { template: "<a><slot /></a>", props: ["to"] },
        },
      },
    });

    const links = wrapper.findAll("a");
    const active = links.filter((link) => link.classes().includes("!bg-indigo-600"));
    expect(active).toHaveLength(1);
    expect(active[0].text()).toContain("我的文章");
  });
});
