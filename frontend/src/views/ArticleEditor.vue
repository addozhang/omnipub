<template>
  <div class="flex h-full flex-col">
    <!-- 标题 -->
    <input
      v-model="title"
      type="text"
      placeholder="请输入文章标题"
      class="mb-4 w-full shrink-0 border-0 bg-transparent text-3xl font-bold text-gray-900 outline-none placeholder:text-gray-300 dark:text-gray-100 dark:placeholder:text-gray-600"
    />

    <!-- Vditor 编辑器 -->
    <div id="vditor" class="min-h-[300px] flex-1"></div>

    <!-- 文章元数据：分类、标签、摘要 -->
    <div class="mt-4 shrink-0 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">分类</label>
          <input
            v-model="category"
            type="text"
            placeholder="例如：后端、云原生"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">标签</label>
          <input
            v-model="tags"
            type="text"
            placeholder="多个标签用逗号分隔，例如：Kubernetes,Service Mesh"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
      </div>
      <div>
        <div class="mb-1 flex items-center justify-between">
          <label class="text-xs font-medium text-gray-500 dark:text-gray-400">摘要</label>
          <span
            class="text-xs"
            :class="summary.length > 50 ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'"
          >{{ summary.length }}/50</span>
        </div>
        <textarea
          v-model="summary"
          maxlength="50"
          rows="2"
          placeholder="文章摘要，不超过 50 字"
          class="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        ></textarea>
      </div>
    </div>

    <!-- 底部工具栏 -->
    <div
      class="mt-4 flex shrink-0 items-center justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700"
    >
      <button
        :disabled="saving"
        class="rounded-lg bg-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        @click="handleSave('draft')"
      >
        保存草稿
      </button>
      <button
        :disabled="saving"
        class="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
        @click="handleSave('published')"
      >
        {{ saving ? "保存中..." : isEdit ? "更新文章" : "发布文章" }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter, onBeforeRouteLeave } from "vue-router";
import { useArticlesStore } from "../stores/articles";

const route = useRoute();
const router = useRouter();
const articlesStore = useArticlesStore();

const title = ref("");
const category = ref("");
const tags = ref("");
const summary = ref("");
const saving = ref(false);
const isEdit = computed(() => !!route.params.id);
let vditor = null;
// U-C3: Track saved state to detect unsaved changes
let savedTitle = "";
let savedContent = "";
let savedCategory = "";
let savedTags = "";
let savedSummary = "";

function isDirty() {
  if (!vditor) return false;
  const currentContent = vditor.getValue() || "";
  return title.value !== savedTitle || currentContent !== savedContent
    || category.value !== savedCategory || tags.value !== savedTags
    || summary.value !== savedSummary;
}

// U-C3: Navigation guard for unsaved changes
onBeforeRouteLeave((_to, _from, next) => {
  if (isDirty() && !saving.value) {
    const leave = window.confirm("你有未保存的更改，确认离开？");
    next(leave);
  } else {
    next();
  }
});

function handleBeforeUnload(e) {
  if (isDirty() && !saving.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}

function calcEditorHeight() {
  const el = document.getElementById("vditor");
  if (!el) return 500;
  const rect = el.getBoundingClientRect();
  // Leave room for bottom toolbar (~72px: mt-4 + pt-4 + button height)
  return Math.max(300, window.innerHeight - rect.top - 72);
}

onMounted(async () => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("resize", handleResize);

  const { default: Vditor } = await import("vditor");
  vditor = new Vditor("vditor", {
    height: calcEditorHeight(),
    mode: "sv",
    lang: "zh_CN",
    placeholder: "开始写作...",
    theme: document.documentElement.classList.contains("dark")
      ? "dark"
      : "classic",
    toolbar: [
      "headings",
      "bold",
      "italic",
      "strike",
      "|",
      "line",
      "quote",
      "list",
      "ordered-list",
      "check",
      "|",
      "code",
      "inline-code",
      "table",
      "link",
      "upload",
      "|",
      "undo",
      "redo",
      "|",
      "fullscreen",
      "preview",
      "outline",
    ],
    preview: {
      hljs: { lineNumber: true },
    },
    upload: {
      // 图片粘贴上传（先用 base64）
      accept: "image/*",
      handler(files) {
        for (const file of files) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64 = e.target.result;
            vditor.insertValue(`![${file.name}](${base64})\n`);
          };
          reader.readAsDataURL(file);
        }
        return null;
      },
    },
    cache: { enable: false },
    after() {
      // 编辑已有文章时加载内容
      if (isEdit.value) {
        loadArticle();
      }
    },
  });
});

function handleResize() {
  if (!vditor) return;
  const h = calcEditorHeight();
  const el = document.getElementById("vditor");
  if (el) el.style.height = `${h}px`;
}

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  vditor?.destroy();
});

async function loadArticle() {
  try {
    const article = await articlesStore.loadArticle(
      Number(route.params.id),
    );
    title.value = article.title;
    category.value = article.category || "";
    tags.value = article.tags || "";
    summary.value = article.summary || "";
    vditor?.setValue(article.markdown_content || "");
    savedTitle = article.title;
    savedContent = article.markdown_content || "";
    savedCategory = article.category || "";
    savedTags = article.tags || "";
    savedSummary = article.summary || "";
  } catch {
    window.$toast?.("加载文章失败", "error");
    router.push("/articles");
  }
}

async function handleSave(status) {
  const markdown_content = vditor?.getValue() || "";
  if (!title.value.trim()) {
    window.$toast?.("请输入文章标题", "warning");
    return;
  }
  if (!markdown_content.trim()) {
    window.$toast?.("请输入文章内容", "warning");
    return;
  }

  saving.value = true;
  try {
    const data = {
      title: title.value.trim(),
      markdown_content,
      status,
      category: category.value.trim() || null,
      tags: tags.value.trim() || null,
      summary: summary.value.trim() || null,
    };

    if (isEdit.value) {
      await articlesStore.updateArticle(Number(route.params.id), data);
      window.$toast?.("文章已更新");
    } else {
      const article = await articlesStore.createArticle(data);
      window.$toast?.("文章已创建");
      router.replace(`/articles/${article.id}/edit`);
    }
    savedTitle = data.title;
    savedContent = data.markdown_content;
    savedCategory = data.category || "";
    savedTags = data.tags || "";
    savedSummary = data.summary || "";
  } catch {
    window.$toast?.("保存失败", "error");
  } finally {
    saving.value = false;
  }
}
</script>
