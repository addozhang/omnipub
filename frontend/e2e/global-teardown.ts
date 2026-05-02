// No-op teardown: leave services running for fast re-runs.
// Run `docker compose down` manually when done.
export default async function globalTeardown() {
  console.log("\n📝 Services left running. Run `docker compose down` to stop.");
}
