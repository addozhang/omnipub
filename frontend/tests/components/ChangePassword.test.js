import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../../src/api/user", () => ({
  changePassword: vi.fn(),
}));

import { changePassword } from "../../src/api/user";
import ChangePassword from "../../src/components/ChangePassword.vue";

describe("ChangePassword.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mountChangePassword() {
    return mount(ChangePassword);
  }

  it("renders form with 3 password fields and submit button", () => {
    const wrapper = mountChangePassword();

    const passwordInputs = wrapper.findAll('input[type="password"]');
    expect(passwordInputs).toHaveLength(3);

    const btn = wrapper.find('button[type="submit"]');
    expect(btn.text()).toBe("修改密码");
  });

  it("shows mismatch error when passwords differ", async () => {
    const wrapper = mountChangePassword();

    const inputs = wrapper.findAll('input[type="password"]');
    await inputs[0].setValue("old123");
    await inputs[1].setValue("new123");
    await inputs[2].setValue("different123");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.text()).toContain("两次输入的新密码不一致");
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("calls changePassword on valid submit", async () => {
    changePassword.mockResolvedValue({});
    const wrapper = mountChangePassword();

    const inputs = wrapper.findAll('input[type="password"]');
    await inputs[0].setValue("old123");
    await inputs[1].setValue("new123456");
    await inputs[2].setValue("new123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(changePassword).toHaveBeenCalledWith("old123", "new123456");
  });

  it("shows success message after successful change", async () => {
    changePassword.mockResolvedValue({});
    const wrapper = mountChangePassword();

    const inputs = wrapper.findAll('input[type="password"]');
    await inputs[0].setValue("old123");
    await inputs[1].setValue("new123456");
    await inputs[2].setValue("new123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("密码修改成功");
  });

  it("shows error message on API failure", async () => {
    changePassword.mockRejectedValue({
      response: { data: { message: "当前密码错误" } },
    });
    const wrapper = mountChangePassword();

    const inputs = wrapper.findAll('input[type="password"]');
    await inputs[0].setValue("old123");
    await inputs[1].setValue("new123456");
    await inputs[2].setValue("new123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("当前密码错误");
  });

  it("clears form fields after successful change", async () => {
    changePassword.mockResolvedValue({});
    const wrapper = mountChangePassword();

    const inputs = wrapper.findAll('input[type="password"]');
    await inputs[0].setValue("old123");
    await inputs[1].setValue("new123456");
    await inputs[2].setValue("new123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const clearedInputs = wrapper.findAll('input[type="password"]');
    for (const input of clearedInputs) {
      expect(input.element.value).toBe("");
    }
  });
});
