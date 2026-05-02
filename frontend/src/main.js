import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./assets/main.css";

const app = createApp(App);

app.config.errorHandler = (err, _instance, info) => {
  console.error(`[Vue Error] ${info}:`, err);
};

window.addEventListener("unhandledrejection", (event) => {
  console.error("[Unhandled Promise Rejection]:", event.reason);
});

app.use(createPinia());
app.use(router);

app.mount("#app");
