import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAuthStore } from "../../src/stores/auth";

vi.mock("../../src/api/auth", () => ({
  loginApi: vi.fn(),
  registerApi: vi.fn(),
}));

import { loginApi, registerApi } from "../../src/api/auth";

const mockAuthResponse = {
  success: true,
  data: {
    token: { access_token: "jwt-token" },
    user: { id: 1, email: "test@test.com", username: "testuser" },
  },
};

describe("auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("initial state uses empty localStorage", () => {
    const store = useAuthStore();
    expect(store.token).toBe("");
    expect(store.user).toBe(null);
    expect(store.isLoggedIn).toBe(false);
  });

  it("initial state reads from localStorage", () => {
    localStorage.setItem("token", "stored-token");
    localStorage.setItem(
      "user",
      JSON.stringify({ id: 2, email: "a@b.com", username: "ab" }),
    );
    const store = useAuthStore();
    expect(store.token).toBe("stored-token");
    expect(store.user).toEqual({ id: 2, email: "a@b.com", username: "ab" });
    expect(store.isLoggedIn).toBe(true);
  });

  it("login stores token/user and dispatches event", async () => {
    loginApi.mockResolvedValue(mockAuthResponse);
    const store = useAuthStore();
    const res = await store.login("test@test.com", "password");

    expect(loginApi).toHaveBeenCalledWith("test@test.com", "password");
    expect(store.token).toBe("jwt-token");
    expect(store.user).toEqual(mockAuthResponse.data.user);
    expect(localStorage.setItem).toHaveBeenCalledWith("token", "jwt-token");
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "user",
      JSON.stringify(mockAuthResponse.data.user),
    );
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = window.dispatchEvent.mock.calls[0][0];
    expect(event.type).toBe("omnipub:set-token");
    expect(event.detail).toEqual({ token: "jwt-token" });
    expect(res).toBe(mockAuthResponse);
  });

  it("login propagates API failure", async () => {
    loginApi.mockRejectedValue(new Error("bad"));
    const store = useAuthStore();
    await expect(store.login("test@test.com", "password")).rejects.toThrow("bad");
    expect(store.token).toBe("");
    expect(store.user).toBe(null);
  });

  it("register stores token/user and dispatches event", async () => {
    registerApi.mockResolvedValue(mockAuthResponse);
    const store = useAuthStore();
    const res = await store.register("test@test.com", "testuser", "password");

    expect(registerApi).toHaveBeenCalledWith("test@test.com", "testuser", "password");
    expect(store.token).toBe("jwt-token");
    expect(store.user).toEqual(mockAuthResponse.data.user);
    expect(localStorage.setItem).toHaveBeenCalledWith("token", "jwt-token");
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "user",
      JSON.stringify(mockAuthResponse.data.user),
    );
    const event = window.dispatchEvent.mock.calls[0][0];
    expect(event.type).toBe("omnipub:set-token");
    expect(event.detail).toEqual({ token: "jwt-token" });
    expect(res).toBe(mockAuthResponse);
  });

  it("logout clears token/user and dispatches null token", () => {
    localStorage.setItem("token", "stored-token");
    localStorage.setItem("user", JSON.stringify({ id: 3 }));
    const store = useAuthStore();
    store.logout();

    expect(store.token).toBe("");
    expect(store.user).toBe(null);
    expect(localStorage.removeItem).toHaveBeenCalledWith("token");
    expect(localStorage.removeItem).toHaveBeenCalledWith("user");
    // calls[0] is init-time sync (token: "stored-token"), calls[1] is logout (token: null)
    const calls = window.dispatchEvent.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0].detail).toEqual({ token: "stored-token" });
    const event = calls[1][0];
    expect(event.type).toBe("omnipub:set-token");
    expect(event.detail).toEqual({ token: null });
  });

  it("isLoggedIn returns true when token set", () => {
    localStorage.setItem("token", "stored-token");
    const store = useAuthStore();
    expect(store.isLoggedIn).toBe(true);
  });

  it("isLoggedIn returns false when token empty", () => {
    const store = useAuthStore();
    expect(store.isLoggedIn).toBe(false);
  });

  it("login succeeds even when extension sync throws", async () => {
    loginApi.mockResolvedValue(mockAuthResponse);
    window.dispatchEvent.mockImplementation(() => {
      throw new Error("extension not available");
    });
    const store = useAuthStore();
    const res = await store.login("test@test.com", "password");

    expect(store.token).toBe("jwt-token");
    expect(res).toBe(mockAuthResponse);
  });
});
