# Build prompt: brolog — a brobridge showcase app

Copy everything below the line into a fresh Claude session running in `/Users/pv/works/brolog`.

---

You are building **brolog**, a small desktop tool that showcases the `brobridge` library. brobridge is a secure transport between a local Node/Bun process and a browser tab: one WebSocket per tab, many multiplexed binary streams, per-stream backpressure, resume across reconnects, and a "trust fence" that stops every other web page in the user's browser from reaching the local process.

brolog is a **single self-contained executable** built with `bun build --compile`. When a user double-clicks it:

1. It starts a brobridge host on `127.0.0.1` on an ephemeral port.
2. It opens the user's default browser at the bridge's one-time-token URL.
3. The bridge serves a dashboard page that is **embedded inside the binary**.
4. The page connects back over brobridge and streams live system vitals read with Node's `os` module.
5. When the user closes the tab, the process exits shortly after.

The point of the demo is brobridge, not the vitals. Every design choice below exists to show a brobridge property honestly. Do not weaken, bypass, or reimplement any part of brobridge's security model.

## Read these first, before writing any code

The brobridge source and docs are on this machine at `/Users/pv/works/brobridge/code`. Read, in this order:

1. `README.md` — the quickstart shows both halves of the API.
2. `docs/configuration.md` — every option of `createBridge` and `connect`.
3. `scripts/demo.ts` — a working host that inlines the client bundle into a served page. brolog is structurally the same thing, grown up.
4. `THREAT-MODEL.md` sections 5.3, 5.4, 5.6 and 8 — you must not violate these.
5. `docs/troubleshooting.md` — the errors you will hit while developing.

Use the **published npm packages**, not the local workspace: `brobridge@0.2.0` (host) and `@brobridgejs/client@0.2.0` (browser). This repo is a real external consumer and proves the packaging. Do not copy brobridge source into this repo.

## Facts about brobridge you must respect

- The bridge serves exactly three routes: `/`, `/ws`, `/rpc`. There is no static file serving and you must not add one. Therefore the dashboard is **one HTML file** with all CSS and JS inline, including the bundled `@brobridgejs/client`.
- The page is supplied to the host via `createBridge({ index: { body, contentType: 'text/html' } })`.
- `bridge.url` is `http://127.0.0.1:<port>/?bt=<one-time token>`. Open it; never log it, never persist it. The token burns on first use and expires after 120 s by default.
- The page connects with `connect(location.href)` from `@brobridgejs/client`. The token is redeemed once, a `SameSite=Strict` HttpOnly cookie is minted, and the URL is cleaned by a 303 redirect.
- Host streams are registered with `bridge.stream(name, async (stream) => { ... })`. `await stream.write(bytes)` resolves as flow-control credit allows — that await **is** the backpressure.
- Host unary methods are registered with `bridge.expose('svc', { method: (...args) => result })` and called from the page as `bridge.call('svc.method', ...args)`.
- The browser side consumes a stream with `for await (const chunk of await bridge.openStream(name, params))`. Iterating grants credit; not iterating is backpressure.
- `bridge.on('state', cb)` on the client reports `connecting | open | resuming | degraded | closed`. `bridge.ping()` returns round-trip ms. `bridge.sessionId` is stable across a resume.
- The client accepts a `socket` factory option. Use it only for the "kill the socket" demo button, exactly as `scripts/demo.ts` does.
- `bridge.sessions` on the host is the array of live protocol sessions. There is no session-closed event; poll this array for the auto-exit feature.
- Served responses carry `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. There is no CSP header, so inline `<script>` and `<style>` work.
- The page must make **zero requests to any origin other than the bridge**. No CDN fonts, no external images, no analytics. System font stack and inline SVG only.
- Do not set `allowNonLoopback`, do not change `allowedOrigins`, do not touch `host`. Defaults are the product.

## Facts about Bun single-file executables you must respect

Reference: https://bun.com/docs/bundler/executables. Local Bun is 1.4.0.

- Embed the built page with an import attribute: `import page from '../dist/index.html' with { type: 'text' }`. `bun build --compile` embeds the string in the binary.
- Do **not** use Bun's HTML imports with `Bun.serve` routes. That hands the listener to `Bun.serve` and bypasses brobridge's fence entirely.
- Compile flags: `--compile --minify --bytecode --target=<target> --outfile=<name>`.
- Targets to produce: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`. All can be cross-compiled from one machine.
- Keep the console window on Windows (do not pass `--windows-hide-console`); the console is the only sign the app is running.
- Bun has no "open browser" API. Spawn the platform opener with `Bun.spawn`: `open <url>` on macOS, `xdg-open <url>` on Linux, `cmd /c start "" <url>` on Windows. Pass the URL as a single argv element, never through a shell string. If the spawn fails, print the URL so the user can paste it.

## Architecture

```
brolog/
  package.json              bun workspace root, scripts below
  tsconfig.json
  src/
    host/
      main.ts               entry: createBridge, register services, open browser, lifecycle
      vitals.ts             pure functions over node:os -> typed samples
      encode.ts             sample -> Float64Array bytes (shared schema with page)
      open-browser.ts       platform opener
  page/
    index.html              template with <!--APP--> and <!--CSS--> markers
    app.ts                  connect, subscribe streams, render
    charts.ts               canvas sparklines, no library
    schema.ts               same wire schema as src/host/encode.ts (shared file, import from both)
    styles.css
  scripts/
    build-page.ts           Bun.build page/app.ts -> inline into template -> dist/index.html
    build-bin.ts            runs build-page, then bun build --compile per target -> release/
    install.sh              curl installer: detect OS/arch, download from GitHub release, chmod +x, run
  site/
    index.html              GitHub Pages landing page (static, may use external fonts, it is not served by the bridge)
  .github/workflows/
    release.yml             on tag v*: build all targets, attach to GitHub Release
    pages.yml               deploy site/ to GitHub Pages
  README.md
```

Vanilla TypeScript everywhere. No UI framework, no chart library, no runtime dependencies beyond the two brobridge packages.

## Host behaviour (`src/host/main.ts`)

1. `const bridge = await createBridge({ index: { body: page, contentType: 'text/html' } })`.
2. Register streams. Each stream loops until the client cancels, sampling at the interval the client passed in `params` (default 1000 ms, clamp to 250–5000 ms):
   - `vitals.cpu` — per-core utilisation percent, computed by diffing two consecutive `os.cpus()` `times` snapshots; plus aggregate percent.
   - `vitals.mem` — `totalmem`, `freemem`, used, percent.
   - `vitals.load` — `os.loadavg()`; on Windows send three `NaN` and let the page show "n/a".
   - `vitals.net` — per interface: name, family, address with the last octet (IPv4) or last hextet (IPv6) replaced by `x`, `internal` flag. Send once every 5 samples; interfaces rarely change.
3. Register a unary service `system.info` returning `hostname`, `platform`, `arch`, `release`, `version`, `uptime`, `cpuModel`, `cpuCount`, `totalmem`. Do **not** include `os.userInfo()` or `homedir`.
4. Register `demo.echo` returning its argument, used by the page as a connectivity check.
5. Print exactly this to stdout, nothing more:
   ```
   brolog — opening your browser…
   If it did not open, paste this into the address bar: <bridge.url>
   Close the tab to quit, or press Ctrl+C.
   ```
   This is the one deliberate exception to "never print the URL": the terminal is the user's own, and the token is one-time and expires in 120 s. Do not write it anywhere else.
6. Open the browser.
7. Lifecycle: every 2 s check `bridge.sessions.length`. Once at least one session has ever existed and the count has been zero for 30 continuous seconds, call `bridge.close()` and exit 0. If no session ever connects within 3 minutes, print "no browser connected, exiting" and exit 1. Handle `SIGINT`/`SIGTERM` with `bridge.close()` then exit 0.

## Wire schema (`page/schema.ts`, imported by both sides)

Every vitals chunk is a `Float64Array` written as raw bytes. Never JSON for hot streams; JSON is fine for `system.info` and `vitals.net`, which are cold. Define:

- `cpu`: `[timestampMs, aggregatePercent, coreCount, core0, core1, ...]`
- `mem`: `[timestampMs, totalBytes, freeBytes]`
- `load`: `[timestampMs, load1, load5, load15]`

Write one encoder and one decoder per stream in this file and use them from both host and page. Count bytes on both sides so the page can display "bytes received vs. equivalent JSON size".

## Page behaviour (`page/app.ts`)

Layout, top to bottom:

1. **Header**: app name, `hostname`, `platform/arch`, uptime ticking locally.
2. **Connection strip**: state badge bound to `bridge.on('state')`, `sessionId` (short form), `ping()` every 5 s shown as ms, "bytes over the wire" counter and the JSON-equivalent counter beside it.
3. **CPU panel**: aggregate sparkline (60 s rolling), per-core bars. A **"pause this stream"** toggle that stops iterating the `vitals.cpu` async iterator (do not close it — hold the iterator and stop calling `next()`). While paused, the other panels must keep updating. Label: "Paused. The host is blocked on this stream's credit; the others are not."
4. **Memory panel**: used/total gauge and a sparkline.
5. **Load panel**: three numbers; "n/a on Windows" when NaN.
6. **Network panel**: table of masked interfaces.
7. **Demo controls**:
   - **"Kill the socket"** — closes the live WebSocket via the `socket` factory handle. Expected observable result: state goes `resuming` then `open`, `sessionId` unchanged, sparklines show no gap. Show a small event log under the button that records state transitions with timestamps.
   - **Sample interval** selector (250 ms / 1 s / 2 s) that reopens the streams with new params.
8. **"How this works"** collapsible: five short sentences explaining one-time token, `SameSite=Strict` cookie, exact `Host` match, `Sec-Fetch-Site` and `Origin` fence, and that this page was served from inside the binary. Link to the brobridge repo.

Error states the page must handle visibly: bootstrap refused (token already used — e.g. user reloaded a stale URL — tell them to relaunch the app), host gone (`closed` state — tell them the app has exited), and `SnapshotRequiredError` after a long disconnect (clear the charts and resubscribe).

Visual: dark, monospace numerals, single accent colour, no gradients, no animation beyond the charts. Must look good at 900 px wide and still work at 400 px. Respect `prefers-reduced-motion` by dropping chart smoothing.

## Build pipeline (`scripts/`)

- `bun run build:page` — `Bun.build({ entrypoints: ['page/app.ts'], target: 'browser', minify: true })`, then inline the JS and `styles.css` into the template at the markers, write `dist/index.html`. Fail if the result contains any `http://` or `https://` string other than the brobridge repo link inside the "How this works" text.
- `bun run build:bin` — runs `build:page`, then for each target runs `bun build --compile --minify --bytecode --target=<t> ./src/host/main.ts --outfile release/brolog-<os>-<arch>[.exe]`. Print the size of each output.
- `bun run dev` — runs `build:page` then `bun src/host/main.ts` directly (no compile) for fast iteration.
- `bun run check` — `tsc --noEmit`, plus the tests below.

## Tests (Bun test runner)

- `vitals.test.ts`: CPU percent from two synthetic `os.cpus()` snapshots; memory percent; IPv4 and IPv6 masking; Windows `loadavg` produces NaNs.
- `schema.test.ts`: encode → decode round-trips for all three hot streams; byte lengths are exact.
- `host.test.ts`: start the host in-process with `bun`, fetch `/` without a cookie and assert 403 (fence intact), then use `@brobridgejs/client` with injected `fetch`/`socket` per `docs/configuration.md` to connect via `bridge.url`, call `demo.echo`, read three `vitals.mem` chunks, and assert the decoded `totalBytes` equals `os.totalmem()`.
- A **manual smoke script** in the README: build the darwin-arm64 binary, run it, confirm the browser opens, confirm the page connects, click "Kill the socket", confirm `sessionId` unchanged, pause CPU and confirm memory still ticks, close the tab, confirm the process exits within ~30 s.

## GitHub Pages landing (`site/index.html`)

Static page, not served by the bridge, so it may use web fonts. Content:

- One-paragraph pitch: what brolog is, what brobridge is, why "loopback is not a security boundary in a browser".
- Three install tabs, in this order: **curl** (`curl -fsSL https://<user>.github.io/brolog/install.sh | sh`), **Bun users** (`bunx brolog` — only if you also publish the package; otherwise omit this tab), **Direct download** (buttons per target linking to `https://github.com/<user>/brolog/releases/latest/download/brolog-<os>-<arch>`).
- An honest note under Direct download: binaries are ~50–60 MB because the Bun runtime is embedded; macOS will block an unsigned download and the user must allow it in Privacy & Security or use the curl installer; Windows SmartScreen shows a one-time warning.
- A screenshot placeholder for the dashboard and a link to the brobridge repository.

Deploy `site/` plus a copy of `scripts/install.sh` with the `pages.yml` workflow.

## Release workflow (`.github/workflows/release.yml`)

Trigger on tags `v*`. One `ubuntu-latest` job: `oven-sh/setup-bun` pinned to 1.4.x, `bun install`, `bun run check`, `bun run build:bin`, then create a GitHub Release and upload every file in `release/`. Do not attempt macOS code signing in this version.

## Definition of done

- `bun run check` passes.
- `bun run build:bin` produces five binaries and prints their sizes.
- Running the macOS arm64 binary on this machine opens the browser, the page connects, all four panels update, "Kill the socket" resumes with the same `sessionId`, pausing CPU does not stall memory, closing the tab exits the process.
- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/` against a running instance returns `403`.
- `dist/index.html` contains no external URL except the brobridge repo link.
- README documents: what it is, install, how it works (short), how to build, the manual smoke test, and a "what this deliberately does not do" section (no non-loopback bind, no hosted UI, no user identity, no disk or process data).

## Working method

- Work in small commits with clear messages. Do not push.
- When brobridge behaves differently from what this prompt claims, trust the brobridge docs and source over this prompt, and say so in your final summary.
- Do not add dependencies beyond the two brobridge packages and `typescript` as a dev dependency.
- Do not modify anything under `/Users/pv/works/brobridge`.
- If a step cannot be completed (for example cross-compiling a target fails on this machine), finish everything else and report exactly what was skipped and why.
