// 每个平台的可配置字段（用于渲染动态表单）
export const PLATFORM_FIELDS = {
  juejin: [
    { key: "category", label: "分类", type: "select", options: ["前端","后端","Android","iOS","人工智能","开发工具","代码人生","阅读"] },
    { key: "tags", label: "标签", type: "tags" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  csdn: [
    { key: "tags", label: "标签", type: "tags" },
    { key: "original", label: "原创声明", type: "checkbox", default: true },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  zhihu: [
    { key: "column_id", label: "专栏 ID", type: "text", placeholder: "留空则不发布到专栏" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  cnblogs: [
    { key: "category", label: "分类", type: "text", placeholder: "个人分类名称" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  toutiao: [
    { key: "tags", label: "标签", type: "tags" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  "tencent-cloud": [
    { key: "tags", label: "标签", type: "tags" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  "51cto": [
    { key: "category", label: "分类", type: "text" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  segmentfault: [
    { key: "tags", label: "标签", type: "tags" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  oschina: [
    { key: "tags", label: "标签", type: "tags" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  infoq: [
    { key: "tags", label: "标签", type: "tags" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
  bilibili: [
    { key: "open_mode", label: "可见范围", type: "select", options: ["所有人可见", "仅自己可见"], default: "所有人可见" },
    { key: "append_markdown", label: "文末追加内容", type: "textarea", placeholder: "Markdown 格式，发布时自动追加到文章末尾" },
  ],
};
