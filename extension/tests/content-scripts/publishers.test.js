import { beforeEach, describe, expect, it, vi } from "vitest";

const publisherModules = [
  { slug: "juejin", path: "../../content-scripts/publishers/juejin.js" },
  { slug: "csdn", path: "../../content-scripts/publishers/csdn.js" },
  { slug: "zhihu", path: "../../content-scripts/publishers/zhihu.js" },
  { slug: "cnblogs", path: "../../content-scripts/publishers/cnblogs.js" },
  { slug: "toutiao", path: "../../content-scripts/publishers/toutiao.js" },
  { slug: "tencent-cloud", path: "../../content-scripts/publishers/tencent-cloud.js" },
  { slug: "51cto", path: "../../content-scripts/publishers/51cto.js" },
  { slug: "segmentfault", path: "../../content-scripts/publishers/segmentfault.js" },
  { slug: "oschina", path: "../../content-scripts/publishers/oschina.js" },
  { slug: "infoq", path: "../../content-scripts/publishers/infoq.js" },
  { slug: "bilibili", path: "../../content-scripts/publishers/bilibili.js" },
];

const setupDomMocks = (href = "https://example.com/editor") => {
  globalThis.window = globalThis;
  globalThis.window.location = { href };
  globalThis.document = {
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  };
};

const createMockBasePublisher = () => {
  const instances = [];

  class MockBasePublisher {
    constructor(slug) {
      this.platform = slug;
      this.publishSelectors = [];
    }

    init() {
      instances.push(this);
    }

    waitForSelector() {
      return Promise.resolve(null);
    }

    waitForElement() {
      return Promise.resolve(null);
    }

    delay() {
      return Promise.resolve();
    }
  }

  globalThis.BasePublisher = MockBasePublisher;
  globalThis.window.BasePublisher = MockBasePublisher;

  return { instances, MockBasePublisher };
};

const loadPublisher = async (path) => {
  vi.resetModules();
  const href = path.includes("bilibili")
    ? "https://member.bilibili.com/york/read-editor?test"
    : "https://example.com/editor";
  setupDomMocks(href);
  const { instances } = createMockBasePublisher();
  await import(path);
  return instances[0];
};

beforeEach(() => {
  setupDomMocks();
});

describe("content script publishers", () => {
  publisherModules.forEach(({ slug, path }) => {
    it(`instantiates ${slug} publisher with correct slug`, async () => {
      const instance = await loadPublisher(path);
      expect(instance).toBeTruthy();
      expect(instance.platform).toBe(slug);
    });
  });

  it("juejin publisher defines publish selectors", async () => {
    const instance = await loadPublisher(
      "../../content-scripts/publishers/juejin.js"
    );
    expect(instance.publishSelectors).toEqual([]);
    expect(instance.constructor.prototype).toHaveProperty("afterFill");
  });

  it("bilibili publisher defines custom fillTitle() and fillBody()", async () => {
    const instance = await loadPublisher(
      "../../content-scripts/publishers/bilibili.js"
    );
    expect(instance.constructor.prototype.hasOwnProperty("fillTitle")).toBe(true);
    expect(instance.constructor.prototype.hasOwnProperty("fillBody")).toBe(true);
    expect(instance.constructor.prototype.hasOwnProperty("afterFill")).toBe(true);
  });

  it("infoq publisher defines afterFill() hook", async () => {
    const instance = await loadPublisher(
      "../../content-scripts/publishers/infoq.js"
    );
    expect(instance.constructor.prototype.hasOwnProperty("afterFill")).toBe(
      true
    );
  });

  describe("oschina 目录解析", () => {
    const loadOschina = () =>
      loadPublisher("../../content-scripts/publishers/oschina.js");

    it("选择文章数最多的目录（发布 API 要求 catalog 必填）", async () => {
      const instance = await loadOschina();
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          result: [
            { id: 7274280, name: "工作日志", blogCount: 0 },
            { id: 7274281, name: "日常记录", blogCount: 81 },
            { id: 12527182, name: "笔记", blogCount: 3 },
          ],
        }),
      }));

      await expect(instance._resolveCatalogId()).resolves.toBe(7274281);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://apiv1.oschina.net/oschinapi/blog_catalog/list_by_user",
        expect.objectContaining({ credentials: "include" })
      );
    });

    it("目录 ID 只解析一次并缓存", async () => {
      const instance = await loadOschina();
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: [{ id: 42, name: "x", blogCount: 1 }] }),
      }));

      await instance._resolveCatalogId();
      await instance._resolveCatalogId();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("目录列表为空时抛错而不是回退到 catalog=0", async () => {
      // 回归测试：旧实现硬编码 catalog: 0，改版后被 API 拒绝
      // {"message":"catalog: 目录 ID 不能为空","code":500}
      const instance = await loadOschina();
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: [] }),
      }));

      await expect(instance._resolveCatalogId()).rejects.toThrow("目录列表为空");
    });
  });
});
