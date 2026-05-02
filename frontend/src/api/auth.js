import api from "./index";

export function loginApi(email, password) {
  return api.post("/auth/login", { email, password });
}

export function registerApi(email, username, password) {
  return api.post("/auth/register", { email, username, password });
}
