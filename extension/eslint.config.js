import globals from "globals";

export default [
  {
    ignores: ["node_modules/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker,
        // 扩展内部跨文件全局（通过 manifest content_scripts 注入顺序保证）
        BasePublisher: "readonly",
        MessageBridge: "readonly",
        EditorAdapter: "readonly",
        EditorAdapterFactory: "readonly",
        SuccessDetector: "readonly",
        PLATFORM_CONFIGS: "readonly",
        showOverlay: "readonly",
        hideOverlay: "readonly",
        updateOverlay: "readonly",
        // 第三方编辑器库（由目标平台页面注入）
        monaco: "readonly",
        Quill: "readonly",
        UE: "readonly",
      },
      ecmaVersion: 2022,
      sourceType: "script",
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },
  {
    // ESM files: eslint config + vitest config + test files
    files: ["eslint.config.js", "vitest.config.js", "tests/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
