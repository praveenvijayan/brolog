import page from "../../dist/index.html" with { type: "text" };
import { version } from "../../package.json" with { type: "json" };
import { startHost } from "./bridge";
import { openBrowser } from "./open-browser";
async function main() {
  if (process.argv.slice(2).some((arg) => arg === "--version" || arg === "-v")) {
    console.log(`brolog v${version}`);
    return;
  }
  const bridge = await startHost(page);
  let shuttingDown = false;
  async function quit(code: number) {
    if (shuttingDown) return;
    shuttingDown = true;
    await bridge.close();
    process.exit(code);
  }
  process.on("SIGINT", () => void quit(0));
  process.on("SIGTERM", () => void quit(0));
  console.log(
    `brolog v${version} — opening your browser…\nIf it did not open, paste this into the address bar: ${bridge.url}\nClose the tab to quit, or press Ctrl+C.`,
  );
  void openBrowser(bridge.url);
  const started = Date.now();
  let seen = false,
    emptySince: number | null = null;
  setInterval(() => {
    const now = Date.now();
    // sessions includes detached replay state; count attached public endpoints.
    if (bridge.sessions.length) seen = true;
    if (bridge.sessions.some((s) => s.endpoint.state === "open"))
      emptySince = null;
    else if (seen) {
      emptySince ??= now;
      if (now - emptySince >= 30000) void quit(0);
    } else if (now - started >= 180000) {
      console.log("no browser connected, exiting");
      void quit(1);
    }
  }, 2000);
}
void main().catch(() => {
  console.error("brolog could not start");
  process.exit(1);
});
