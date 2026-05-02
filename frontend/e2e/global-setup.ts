import { execSync } from "child_process";
import { setTimeout } from "timers/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../");

export default async function globalSetup() {
  // Check if services are already running; if not, start them
  try {
    const res = await fetch("http://localhost:3000/api/health");
    if (res.ok) {
      console.log("✅ Services already running");
      return;
    }
  } catch {
    // not running, start them
  }

  console.log("\n🐳 Starting services via docker compose...");
  execSync("docker compose up -d", { cwd: ROOT, stdio: "inherit" });

  console.log("⏳ Waiting for services to be ready...");
  await waitForUrl("http://localhost:3000/api/health", 60_000);
  console.log("✅ Services ready\n");
}

async function waitForUrl(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await setTimeout(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
