import api from "./index";

export function getPlatforms() {
  return api.get("/platforms");
}
