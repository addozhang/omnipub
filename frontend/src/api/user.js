import api from "./index";

export function changePassword(currentPassword, newPassword) {
  return api.put("/user/password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
