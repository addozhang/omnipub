import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/login",
    name: "Login",
    component: () => import("../views/Login.vue"),
    meta: { guest: true },
  },
  {
    path: "/",
    component: () => import("../components/AppLayout.vue"),
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        name: "Dashboard",
        component: () => import("../views/Dashboard.vue"),
      },
      {
        path: "articles",
        name: "ArticleList",
        component: () => import("../views/ArticleList.vue"),
      },
      {
        path: "articles/new",
        name: "ArticleNew",
        component: () => import("../views/ArticleEditor.vue"),
      },
      {
        path: "articles/:id/edit",
        name: "ArticleEdit",
        component: () => import("../views/ArticleEditor.vue"),
      },
      {
        path: "articles/:id/publish",
        name: "ArticlePublish",
        component: () => import("../views/ArticlePublish.vue"),
      },
      {
        path: "publications",
        name: "Publications",
        component: () => import("../views/Publications.vue"),
      },
      {
        path: "settings",
        name: "Settings",
        component: () => import("../views/Settings.vue"),
      },
      {
        path: "user/settings",
        name: "UserSettings",
        component: () => import("../views/UserSettings.vue"),
      },
    ],
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    redirect: { name: "Dashboard" },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// H-U7: Check if JWT token is expired by decoding the payload
function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    // exp is in seconds, Date.now() is in ms
    return payload.exp ? payload.exp * 1000 < Date.now() : false;
  } catch {
    // Malformed token — treat as expired
    return true;
  }
}

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem("token");

  if (to.meta.requiresAuth) {
    if (!token || isTokenExpired(token)) {
      // H-U7: Clear expired token and redirect to login
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      next({ name: "Login" });
    } else {
      next();
    }
  } else if (to.meta.guest && token && !isTokenExpired(token)) {
    next({ name: "Dashboard" });
  } else {
    next();
  }
});

export default router;
