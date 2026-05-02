import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("vue-router", () => ({
  useRouter: vi.fn(),
}));

vi.mock("../../src/stores/auth", () => ({
  useAuthStore: vi.fn(),
}));

import { useRouter } from "vue-router";
import { useAuthStore } from "../../src/stores/auth";
import Login from "../../src/views/Login.vue";

describe("Login.vue", () => {
  let mockLogin;
  let mockRegister;
  let mockPush;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogin = vi.fn();
    mockRegister = vi.fn();
    mockPush = vi.fn();

    useRouter.mockReturnValue({ push: mockPush });
    useAuthStore.mockReturnValue({ login: mockLogin, register: mockRegister });
  });

  function mountLogin() {
    return mount(Login, {
      global: {
        stubs: { RouterLink: true },
      },
    });
  }

  it("renders login form by default", () => {
    const wrapper = mountLogin();

    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);

    const submitBtn = wrapper.find('button[type="submit"]');
    expect(submitBtn.text()).toBe("登录");
  });

  it("switches to register tab and shows username field", async () => {
    const wrapper = mountLogin();

    expect(wrapper.find('input[type="text"]').exists()).toBe(false);

    const buttons = wrapper.findAll("button");
    const registerTab = buttons.find((b) => b.text() === "注册");
    expect(registerTab).toBeDefined();
    await registerTab.trigger("click");

    expect(wrapper.find('input[type="text"]').exists()).toBe(true);

    const submitBtn = wrapper.find('button[type="submit"]');
    expect(submitBtn.text()).toBe("注册");
  });

  it("calls authStore.login on login submit with correct args", async () => {
    mockLogin.mockResolvedValue({});
    const wrapper = mountLogin();

    await wrapper.find('input[type="email"]').setValue("test@example.com");
    await wrapper.find('input[type="password"]').setValue("password123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockLogin).toHaveBeenCalledWith("test@example.com", "password123");
  });

  it("calls authStore.register on register submit with correct args", async () => {
    mockRegister.mockResolvedValue({});
    const wrapper = mountLogin();

    const buttons = wrapper.findAll("button");
    const registerTab = buttons.find((b) => b.text() === "注册");
    await registerTab.trigger("click");

    await wrapper.find('input[type="email"]').setValue("new@example.com");
    await wrapper.find('input[type="text"]').setValue("newuser");
    await wrapper.find('input[type="password"]').setValue("pass123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockRegister).toHaveBeenCalledWith(
      "new@example.com",
      "newuser",
      "pass123456"
    );
  });

  it("shows error message on login failure", async () => {
    mockLogin.mockRejectedValue({
      response: { data: { message: "密码错误" } },
    });
    const wrapper = mountLogin();

    await wrapper.find('input[type="email"]').setValue("test@example.com");
    await wrapper.find('input[type="password"]').setValue("wrongpass");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("密码错误");
  });

  it("navigates to /articles on successful login", async () => {
    mockLogin.mockResolvedValue({});
    const wrapper = mountLogin();

    await wrapper.find('input[type="email"]').setValue("test@example.com");
    await wrapper.find('input[type="password"]').setValue("password123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockPush).toHaveBeenCalledWith("/articles");
  });
});
