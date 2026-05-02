<template>
  <!-- Modal overlay -->
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @click.self="$emit('close')"
  >
    <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
      <!-- Header -->
      <div class="mb-1 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {{ platformName }} 发布配置
        </h3>
        <button
          class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          @click="$emit('close')"
        >✕</button>
      </div>
      <!-- 模式说明 -->
      <p class="mb-4 text-xs text-gray-400 dark:text-gray-500">
        <span v-if="saveToBackend">修改后将保存为该渠道的默认发布配置</span>
        <span v-else>本次发布的临时配置，不会修改默认设置</span>
      </p>

      <!-- Fields -->
      <div class="space-y-4">
        <div v-for="field in fields" :key="field.key">
          <label v-if="field.type !== 'checkbox'" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ field.label }}
          </label>

          <!-- text -->
          <input
            v-if="field.type === 'text'"
            v-model="formData[field.key]"
            :placeholder="field.placeholder || ''"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />

          <!-- select -->
          <select
            v-else-if="field.type === 'select'"
            v-model="formData[field.key]"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            <option value="">-- 请选择 --</option>
            <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
          </select>

          <!-- checkbox -->
          <label
            v-else-if="field.type === 'checkbox'"
            class="flex items-center gap-2 cursor-pointer"
          >
            <input
              type="checkbox"
              v-model="formData[field.key]"
              class="h-4 w-4 rounded border-gray-300 text-indigo-500"
            />
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ field.label }}</span>
          </label>

          <!-- tags -->
          <div v-else-if="field.type === 'tags'">
            <input
              v-model="tagInputs[field.key]"
              placeholder="用逗号分隔，如：Vue,前端,JavaScript"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              @input="syncTags(field.key)"
            />
            <div v-if="parsedTags(field.key).length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="tag in parsedTags(field.key)"
                :key="tag"
                class="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300"
              >{{ tag }}</span>
            </div>
          </div>

          <!-- textarea -->
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="formData[field.key]"
            :placeholder="field.placeholder || ''"
            rows="4"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
      </div>

      <!-- Actions -->
      <div class="mt-6 flex justify-end gap-3">
        <button
          class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          @click="$emit('close')"
        >取消</button>
        <button
          class="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
          :disabled="saving"
          @click="handleSave"
        >{{ saving ? "保存中..." : saveToBackend ? "保存默认" : "应用本次" }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from "vue";
import { PLATFORM_FIELDS } from "../config/platformFields.js";
import { useUserPlatformConfigsStore } from "../stores/userPlatformConfigs.js";

const props = defineProps({
  slug: { type: String, required: true },
  platformName: { type: String, default: "" },
  visible: { type: Boolean, default: false },
  // true = 保存到后端（设置页默认配置）; false = 只返回本次覆盖值（发布页临时配置）
  saveToBackend: { type: Boolean, default: true },
  // 发布页传入：本次已有的覆盖值（优先于默认配置显示）
  overrideConfig: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["close", "saved", "override"]);

const store = useUserPlatformConfigsStore();
const saving = ref(false);
const fields = PLATFORM_FIELDS[props.slug] || [];

const formData = reactive({});
const tagInputs = reactive({});

function initForm() {
  // 优先级：overrideConfig > store 默认 > field.default
  const base = store.configs[props.slug] || {};
  const override = props.overrideConfig || {};
  const merged = { ...base, ...override };

  for (const field of fields) {
    if (field.type === "tags") {
      const val = merged[field.key];
      const arr = Array.isArray(val) ? val : (val ? String(val).split(",").map(s => s.trim()).filter(Boolean) : []);
      tagInputs[field.key] = arr.join(", ");
      formData[field.key] = arr;
    } else if (field.type === "checkbox") {
      formData[field.key] = merged[field.key] !== undefined ? merged[field.key] : (field.default ?? false);
    } else {
      formData[field.key] = merged[field.key] !== undefined ? merged[field.key] : (field.default ?? "");
    }
  }
}

watch(() => props.visible, (v) => { if (v) initForm(); }, { immediate: true });

function syncTags(key) {
  const raw = tagInputs[key] || "";
  formData[key] = raw.split(",").map(s => s.trim()).filter(Boolean);
}

function parsedTags(key) {
  return Array.isArray(formData[key]) ? formData[key] : [];
}

async function handleSave() {
  saving.value = true;
  try {
    if (props.saveToBackend) {
      // 设置页：保存为默认配置
      await store.save(props.slug, { ...formData });
      emit("saved");
    } else {
      // 发布页：只返回本次覆盖值，不写后端
      emit("override", { slug: props.slug, config: { ...formData } });
      emit("saved");
    }
  } catch (e) {
    window.$toast?.("保存配置失败", "error");
  } finally {
    saving.value = false;
  }
}
</script>
