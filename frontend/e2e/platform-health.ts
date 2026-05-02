import { chromium, type BrowserContext, type Page } from "@playwright/test";
import {
  checkSessionHealth,
  cleanStaleLocks,
  fixProfileCrashState,
  grantExtensionHostPermissions,
  restoreCookies,
  saveCookies,
  PLATFORM_SESSIONS,
  type SessionStatus,
  buildReport,
  printSessionReport,
} from "./session-health";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILE_DIR =
  process.env.OMNIPUB_TEST_PROFILE ||
  path.join(os.homedir(), ".omnipub-test-profile");
const EXTENSION_DIR = path.resolve(__dirname, "../../extension");
const REPORT_DIR = path.join(PROFILE_DIR, "health-reports");
const BASELINE_PATH = path.resolve(__dirname, "platform-health-baseline.json");

interface SelectorProbe {
  category: string;
  selector: string;
  found: boolean;
  tagName?: string;
  attributes?: Record<string, string>;
}

interface PlatformHealthResult {
  slug: string;
  name: string;
  sessionOk: boolean;
  navigationOk: boolean;
  editorUrl: string;
  finalUrl: string;
  selectorsProbed: SelectorProbe[];
  selectorsSummary: {
    titleFound: boolean;
    editorFound: boolean;
    publishFound: boolean;
    allFound: boolean;
  };
  fingerprint: string;
  baselineFingerprint?: string;
  fingerprintMatch: boolean;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  screenshotPath?: string;
  error?: string;
  durationMs: number;
}

interface HealthReport {
  checkedAt: string;
  profileDir: string;
  baselineVersion: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  platforms: PlatformHealthResult[];
}

interface BaselinePlatformConfig {
  editorUrl: string;
  selectors: Record<string, string[]>;
  skip?: boolean;
  skipReason?: string;
  fingerprint?: string;
}

interface BaselineRoot {
  version: number;
  platforms: Record<string, BaselinePlatformConfig>;
}

interface CliArgs {
  jsonMode: boolean;
  outputPath?: string;
  slugs?: string[];
}

const baselineRaw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as BaselineRoot;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampForFile(d = new Date()): string {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
}

function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]/g, "_");
}

function isLikelyLoginRedirect(url: string): boolean {
  return /login|passport|signin|signup|sso|auth/i.test(url);
}

function parseArgs(argv: string[]): CliArgs {
  const jsonMode = argv.includes("--json");
  const outputIdx = argv.indexOf("-o");
  const outputPath = outputIdx !== -1 ? argv[outputIdx + 1] : undefined;
  const slugArg = argv.find((a) => a.startsWith("--slugs="));
  const slugs = slugArg?.split("=")[1]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    jsonMode,
    outputPath,
    slugs: slugs && slugs.length > 0 ? slugs : undefined,
  };
}

async function probePlatformSelectors(
  page: Page,
  selectors: Record<string, string[]>,
): Promise<SelectorProbe[]> {
  const probes: SelectorProbe[] = [];

  for (const [category, selectorList] of Object.entries(selectors)) {
    for (const selector of selectorList) {
      const locator = page.locator(selector).first();

      const visible = await locator
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      const count = await locator.count().catch(() => 0);
      const found = visible || count > 0;

      if (!found) {
        probes.push({ category, selector, found: false });
        continue;
      }

      const meta = await locator
        .evaluate((el) => {
          const attrs: Record<string, string> = {};
          const id = el.getAttribute("id");
          const className = el.getAttribute("class");
          const placeholder = el.getAttribute("placeholder");
          const type = el.getAttribute("type");
          const name = el.getAttribute("name");
          const role = el.getAttribute("role");

          if (id) attrs.id = id;
          if (className) attrs.className = className;
          if (placeholder) attrs.placeholder = placeholder;
          if (type) attrs.type = type;
          if (name) attrs.name = name;
          if (role) attrs.role = role;

          return {
            tagName: el.tagName,
            attributes: attrs,
          };
        })
        .catch(() => ({ tagName: undefined, attributes: {} as Record<string, string> }));

      probes.push({
        category,
        selector,
        found: true,
        tagName: meta.tagName,
        attributes: Object.keys(meta.attributes).length > 0 ? meta.attributes : undefined,
      });
    }
  }

  return probes;
}

function computeFingerprint(probes: SelectorProbe[]): string {
  const deterministic = probes
    .filter((p) => p.found)
    .slice()
    .sort((a, b) => {
      const ka = `${a.category}:${a.selector}`;
      const kb = `${b.category}:${b.selector}`;
      return ka.localeCompare(kb);
    })
    .map((p) => `${p.category}:${p.selector}:${p.tagName || "UNKNOWN"}`)
    .join("|");

  return crypto.createHash("sha256").update(deterministic).digest("hex");
}

async function navigateToEditor(
  context: BrowserContext,
  page: Page,
  slug: string,
  baseline: BaselinePlatformConfig,
): Promise<{ url: string; error?: string }> {
  const initialEditorUrl = baseline.editorUrl;
  let actualEditorUrl = initialEditorUrl;
  let navError: string | undefined;

  if (!initialEditorUrl) {
    return { url: page.url(), error: "Missing editorUrl in baseline" };
  }

  void context;

  if (slug === "infoq") {
    try {
      await page.goto("https://xie.infoq.cn", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await delay(1000);

      const draftResult = await page.evaluate(async () => {
        const resp = await fetch("/api/v1/draft/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          credentials: "include",
        });
        const json = (await resp.json()) as {
          code?: number;
          data?: { id?: string | number; draftId?: string | number };
        };
        return {
          code: json?.code,
          id: json?.data?.id ?? json?.data?.draftId,
        };
      });

      if (draftResult.code === 0 && draftResult.id) {
        actualEditorUrl = `https://xie.infoq.cn/draft/${String(draftResult.id)}`;
      } else {
        navError = `InfoQ draft creation failed: code=${String(draftResult.code)} id=${String(draftResult.id)}`;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      navError = `InfoQ draft API error: ${message}`;
    }

    await page.goto(actualEditorUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await delay(2000);

    for (let i = 0; i < 3; i++) {
      const btn = page.locator(':text-is("知道了")').first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => undefined);
        await delay(800);
      } else {
        break;
      }
    }

    return { url: actualEditorUrl, error: navError };
  }

  await page.goto(actualEditorUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await delay(2000);

  if (slug === "oschina") {
    const currentUrl = page.url();
    const uidMatch = currentUrl.match(/\/u\/(\d+)/);
    const isOnWritePage = /\/blog\/write/.test(currentUrl);

    if (!isOnWritePage) {
      let uid = uidMatch?.[1];

      if (!uid) {
        try {
          const apiResult = await page.evaluate(
            "(function(){ return fetch('/action/apiv2/user/myself', { credentials: 'include' }).then(function(r){ return r.json(); }).then(function(j){ return { id: j && j.result && j.result.id ? String(j.result.id) : '0' }; }).catch(function(){ return { id: '0' }; }); })()",
          ) as { id?: string };
          uid = apiResult?.id;
        } catch {
        }
      }

      if (!uid || uid === "0") {
        await page
          .goto("https://my.oschina.net/action/user/info", {
            waitUntil: "domcontentloaded",
            timeout: 10000,
          })
          .catch(() => undefined);
        await delay(1000);
        const redirectUrl = page.url();
        const redirectUid = redirectUrl.match(/\/u\/(\d+)/)?.[1];
        if (redirectUid) uid = redirectUid;
      }

      if (uid && uid !== "0") {
        actualEditorUrl = `https://my.oschina.net/u/${uid}/blog/write`;
        await page.goto(actualEditorUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await delay(2000);
      } else {
        navError = "OSCHINA UID resolution failed";
      }
    }

    const closeGuide = page.locator(':text("关闭引导")').first();
    if (await closeGuide.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeGuide.click({ timeout: 3000 }).catch(() => undefined);
      await delay(1000);
    }
  }

  return { url: actualEditorUrl, error: navError };
}

function summarizeSelectors(probes: SelectorProbe[]): {
  titleFound: boolean;
  editorFound: boolean;
  publishFound: boolean;
  allFound: boolean;
} {
  const titleFound = probes.some((p) => p.category === "title" && p.found);
  const editorFound = probes.some((p) => p.category === "editor" && p.found);
  const publishFound = probes.some((p) => p.category === "publish" && p.found);

  return {
    titleFound,
    editorFound,
    publishFound,
    allFound: titleFound && editorFound && publishFound,
  };
}

async function checkPlatformHealth(
  context: BrowserContext,
  sessionStatuses: SessionStatus[],
  slug: string,
  baseline: BaselineRoot,
): Promise<PlatformHealthResult> {
  const started = Date.now();
  const platformMeta = PLATFORM_SESSIONS.find((p) => p.slug === slug);
  const base = baseline.platforms[slug];

  if (!platformMeta || !base) {
    return {
      slug,
      name: platformMeta?.name || slug,
      sessionOk: false,
      navigationOk: false,
      editorUrl: base?.editorUrl || "",
      finalUrl: "",
      selectorsProbed: [],
      selectorsSummary: {
        titleFound: false,
        editorFound: false,
        publishFound: false,
        allFound: false,
      },
      fingerprint: computeFingerprint([]),
      baselineFingerprint: base?.fingerprint,
      fingerprintMatch: !base?.fingerprint,
      passed: false,
      skipped: false,
      error: "Platform missing in PLATFORM_SESSIONS or baseline",
      durationMs: Date.now() - started,
    };
  }

  if (base.skip === true) {
    return {
      slug,
      name: platformMeta.name,
      sessionOk: false,
      navigationOk: false,
      editorUrl: base.editorUrl,
      finalUrl: "",
      selectorsProbed: [],
      selectorsSummary: {
        titleFound: false,
        editorFound: false,
        publishFound: false,
        allFound: false,
      },
      fingerprint: computeFingerprint([]),
      baselineFingerprint: base.fingerprint,
      fingerprintMatch: !base.fingerprint,
      passed: false,
      skipped: true,
      skipReason: base.skipReason || "Skipped by baseline",
      durationMs: Date.now() - started,
    };
  }

  const status = sessionStatuses.find((s) => s.slug === slug);
  const sessionOk = !!status?.loggedIn;
  const page = await context.newPage();

  let editorUrl = base.editorUrl;
  let finalUrl = "";
  let probes: SelectorProbe[] = [];
  let error: string | undefined;
  let screenshotPath: string | undefined;

  try {
    await page.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      delete window.__playwright;
      delete window.__pw_manual;
    `);

    const nav = await navigateToEditor(context, page, slug, base);
    if (nav.error) {
      error = nav.error;
    }
    editorUrl = nav.url || editorUrl;
    finalUrl = page.url();

    const navigationOk = !isLikelyLoginRedirect(finalUrl);

    probes = await probePlatformSelectors(page, base.selectors || {});
    const selectorsSummary = summarizeSelectors(probes);
    const fingerprint = computeFingerprint(probes);
    const baselineFingerprint = base.fingerprint;
    const fingerprintMatch = baselineFingerprint
      ? baselineFingerprint === fingerprint
      : true;
    const passed = sessionOk && navigationOk && selectorsSummary.allFound;

    if (!passed) {
      if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
      }
      screenshotPath = path.join(
        REPORT_DIR,
        `${timestampForFile()}-${safeName(slug)}-failure.png`,
      );
      await page
        .screenshot({ path: screenshotPath, fullPage: true })
        .catch(() => undefined);
    }

    return {
      slug,
      name: platformMeta.name,
      sessionOk,
      navigationOk,
      editorUrl,
      finalUrl,
      selectorsProbed: probes,
      selectorsSummary,
      fingerprint,
      baselineFingerprint,
      fingerprintMatch,
      passed,
      skipped: false,
      screenshotPath,
      error,
      durationMs: Date.now() - started,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error = error ? `${error}; ${message}` : message;
    finalUrl = page.url();

    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    screenshotPath = path.join(
      REPORT_DIR,
      `${timestampForFile()}-${safeName(slug)}-error.png`,
    );
    await page
      .screenshot({ path: screenshotPath, fullPage: true })
      .catch(() => undefined);

    const selectorsSummary = summarizeSelectors(probes);
    const fingerprint = computeFingerprint(probes);

    return {
      slug,
      name: platformMeta.name,
      sessionOk,
      navigationOk: false,
      editorUrl,
      finalUrl,
      selectorsProbed: probes,
      selectorsSummary,
      fingerprint,
      baselineFingerprint: base.fingerprint,
      fingerprintMatch: base.fingerprint ? base.fingerprint === fingerprint : true,
      passed: false,
      skipped: false,
      screenshotPath,
      error,
      durationMs: Date.now() - started,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function generateReport(results: PlatformHealthResult[]): HealthReport {
  const passed = results.filter((r) => r.passed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.length - passed - skipped;

  return {
    checkedAt: new Date().toISOString(),
    profileDir: PROFILE_DIR,
    baselineVersion: baselineRaw.version,
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
    },
    platforms: results,
  };
}

function printHealthReport(report: HealthReport): void {
  console.log("\n┌──────────── Platform Health Check ────────────┐");

  for (const p of report.platforms) {
    if (p.skipped) {
      const reason = p.skipReason || "Skipped";
      console.log(
        `│  ⏭️ [SKIP   ] ${p.name.padEnd(8)} (${p.slug.padEnd(13)}) ${reason}`,
      );
      continue;
    }

    const icon = p.passed ? "✅" : "❌";
    const status = p.passed ? "PASS" : "FAIL";
    const foundCount = [
      p.selectorsSummary.titleFound,
      p.selectorsSummary.editorFound,
      p.selectorsSummary.publishFound,
    ].filter(Boolean).length;
    const fpLabel = p.baselineFingerprint
      ? p.fingerprintMatch
        ? "match"
        : "CHANGED"
      : "n/a";

    console.log(
      `│  ${icon} [${status.padEnd(7)}] ${p.name.padEnd(8)} (${p.slug.padEnd(13)}) ${String(foundCount).padStart(1)}/3 selectors  fingerprint: ${fpLabel}`,
    );

    if (!p.passed && p.error) {
      console.log(`│      error: ${p.error}`);
    }
  }

  console.log("├───────────────────────────────────────────────┤");
  console.log(
    `│  ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`,
  );

  const effectiveTotal = report.summary.total - report.summary.skipped;
  console.log(
    `│  Total: ${report.summary.passed}/${effectiveTotal > 0 ? effectiveTotal : 0} platforms healthy`,
  );
  console.log("└───────────────────────────────────────────────┘\n");
}

async function runCli(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.jsonMode) {
    console.log("🔍 Checking platform health...");
    console.log(`   Profile: ${PROFILE_DIR}`);
    console.log(`   Baseline: ${BASELINE_PATH}`);
  }

  if (!fs.existsSync(PROFILE_DIR)) {
    if (args.jsonMode) {
      console.log(JSON.stringify({ error: "Profile directory not found" }));
    } else {
      console.error("\n❌ Profile directory not found. Run login seed flow first.\n");
    }
    return 1;
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    if (args.jsonMode) {
      console.log(JSON.stringify({ error: "Baseline file not found" }));
    } else {
      console.error(`\n❌ Baseline file not found: ${BASELINE_PATH}\n`);
    }
    return 1;
  }

  const removedLocks = cleanStaleLocks(PROFILE_DIR);
  fixProfileCrashState(PROFILE_DIR);

  if (!args.jsonMode && removedLocks.length > 0) {
    console.log(`   Cleaned stale locks: ${removedLocks.join(", ")}`);
  }

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--use-mock-keychain",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--disable-blink-features=AutomationControlled",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: [
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
    ],
  });

  try {
    await context.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      delete window.__playwright;
      delete window.__pw_manual;
    `);

    await grantExtensionHostPermissions(context);
    await restoreCookies(context, PROFILE_DIR);

    const targetSlugs = args.slugs
      ? PLATFORM_SESSIONS
          .map((p) => p.slug)
          .filter((slug) => args.slugs?.includes(slug))
      : PLATFORM_SESSIONS.map((p) => p.slug);

    const sessionStatuses = await checkSessionHealth(context, targetSlugs);

    const sessionReport = buildReport(sessionStatuses, PROFILE_DIR);
    if (!args.jsonMode) {
      console.log(
        `   Session readiness: ${sessionReport.summary.active}/${sessionReport.summary.total}`,
      );
      printSessionReport(sessionStatuses);
    }

    const results: PlatformHealthResult[] = [];
    for (const slug of targetSlugs) {
      const health = await checkPlatformHealth(context, sessionStatuses, slug, baselineRaw);
      results.push(health);
    }

    const report = generateReport(results);
    const defaultReportPath = path.join(
      REPORT_DIR,
      `health-${timestampForFile()}.json`,
    );
    fs.writeFileSync(defaultReportPath, JSON.stringify(report, null, 2));

    if (args.jsonMode) {
      const json = JSON.stringify(report, null, 2);
      if (args.outputPath) {
        fs.writeFileSync(args.outputPath, json);
      }
      console.log(json);
    } else {
      printHealthReport(report);
      console.log(`Report written to: ${defaultReportPath}`);
      if (args.outputPath) {
        fs.writeFileSync(args.outputPath, JSON.stringify(report, null, 2));
        console.log(`Report copied to: ${args.outputPath}`);
      }
    }

    return report.summary.failed > 0 ? 1 : 0;
  } finally {
    await saveCookies(context, PROFILE_DIR).catch(() => {});
    await context.close();
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].includes("platform-health") ||
    process.argv[1].endsWith("platform-health.ts"));

if (isDirectRun) {
  runCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Fatal:", message);
      process.exit(1);
    });
}

export {
  checkPlatformHealth,
  probePlatformSelectors,
  computeFingerprint,
  generateReport,
  printHealthReport,
};
export type { PlatformHealthResult, HealthReport, SelectorProbe };
