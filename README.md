# brolog

A single executable that opens a local system dashboard in your browser. CPU, memory, load and masked network interfaces demonstrate [brobridge](https://github.com/praveenvijayan/brobridge): multiplexed binary streams, independent flow control and reconnect/resume.

## Install

After a release is published, macOS and Linux users can run:

```sh
curl -fsSL https://praveenvijayan.github.io/brolog/install.sh | sh
```

The installer downloads to `~/.local/bin/brolog` and runs it. Alternatively, download your platform from [Releases](https://github.com/praveenvijayan/brolog/releases/latest). Windows uses `brolog-windows-x64.exe`. macOS may require allowing an unsigned download in Privacy & Security; Windows may show SmartScreen. The package is private and is not published for `bunx`.

## Build and run

Requires Bun 1.4.x. No runtime dependency beyond the two published bridge packages.

```sh
bun install --frozen-lockfile
bun run check
bun run dev
bun run build:bin
# Or build only this Mac's target:
bun run build:bin darwin-arm64
./release/brolog-darwin-arm64
```

`build:page` bundles vanilla TypeScript and CSS into `dist/index.html`. `build:bin` embeds that string and compiles five targets with minification and bytecode. The binary needs no source files or assets beside it. Local builds with Bun 1.4.0 measured 61.9 MiB (macOS ARM), 68.4 MiB (macOS Intel), 79.6 MiB (Linux x64), 79.5 MiB (Linux ARM) and 85.6 MiB (Windows). These exceed the brief's 50–60 MB estimate because of the embedded runtime.

## How it works

The host uses brobridge's default loopback listener and serves only its built-in routes. Opening the one-time URL burns its token, sets an HttpOnly SameSite=Strict cookie and redirects to a clean URL. Exact Host, Sec-Fetch-Site and Origin checks keep other browser origins outside the fence. The dashboard makes no off-origin resource requests. Its one external link opens the brobridge repository only when clicked.

CPU, memory and load use shared Float64 encoders/decoders; network interfaces use cold JSON. CPU percentages are differences between consecutive OS snapshots. Memory means total minus free, including reclaimable cache; it is not OS memory pressure. On Windows, load is n/a. IPv6 scope suffixes are removed and the last address component is masked.

Pause holds the CPU iterator without cancelling it. The default 64 KiB credit buffer must fill before the producer blocks, so this is not instantaneous. Other streams continue independently. Changing the interval explicitly cancels old streams and opens replacements. Payload byte counters exclude framing, bootstrap, RPC and replay overhead; the JSON comparison uses the same decoded samples. Host-side counters are available through `demo.stats`.

## Differences from the build brief

- Published 0.2.0 packages contain an invalid `@brobridgejs/core: workspace:^` dependency. A Bun override resolves it to the published `@brobridgejs/core@0.2.0`. No local library source is copied or modified.
- `bridge.sessions` retains detached protocol sessions for replay. The lifecycle polls their public `endpoint.state` to detect 30 continuous seconds without an attached tab; counting the array alone would delay exit by the retention period. A disconnect longer than 30 seconds therefore exits this demo, even though the transport supports longer replay windows.
- Ending an async iterator does not cancel its protocol stream. Interval changes use the actual stream's public `cancel()` method.
- A stale token can be refused before HTML is served. In that case the browser displays brobridge's empty 403, so the app cannot render its own error screen without weakening the fence. Relaunch the executable. Errors after the page loads are displayed in the dashboard.
- With automatic reconnect, a vanished host can remain in `resuming`; `closed` is terminal, not an automatic offline timeout. The dashboard reports the actual bridge state.
- Charts use straight segments for everyone, including reduced-motion users. The diagram skill's SVG-only static checker is inapplicable to the explicitly requested interactive canvas dashboard; accessibility is supplied by named canvases and numeric summaries.

## Manual smoke test

1. Build and run the macOS ARM binary with the commands above. Confirm the default browser opens and all four panels receive samples.
2. Note the session ID. Click **Kill the socket** and confirm `resuming → open` with the same ID and continued charts.
3. Click **Pause this stream**. CPU should freeze while memory, load and the received-byte count continue. Resume and watch buffered CPU samples arrive.
4. Change the sample interval between 250 ms, 1 s and 2 s. Confirm all panels keep working, including when changing it while CPU is paused.
5. Resize to 900 px and 400 px. Confirm controls remain usable and only the network table can scroll horizontally.
6. In another terminal, use the port from the launch URL (omit its token):
   `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/`
   Expected: `403`.
7. Close the dashboard tab. The process should exit successfully in roughly 30–34 seconds. Ctrl+C also closes it. Without any connection it exits after three minutes with status 1.

## What this deliberately does not do

No non-loopback bind, hosted UI, user identity, disk or process inspection, telemetry, external assets, filesystem serving or security overrides. System info excludes userInfo and homedir. Launch credentials appear only in the terminal fallback message and browser launch; never in saved files or logs.

## Publishing

Local builds do not publish anything. The release workflow runs checks and attaches all binaries to a GitHub Release on a `v*` tag. The Pages workflow deploys `site/` plus the installer on pushes to `main`; enable GitHub Pages with GitHub Actions as the source. The landing page intentionally keeps the requested screenshot placeholder.

## Verification on this machine

Bun 1.4.0 on macOS ARM64: all 10 tests and TypeScript checks pass. All five binaries compile. The compiled ARM64 binary served live samples, passed an unauthenticated curl 403 check, and resumed the same session after killing the socket. Browser inspection covered 900 px and 400 px (no document overflow). CPU stayed at 14.0% while received bytes increased during pause, including an interval change. After closing the controlled browser tab, the listener stopped in 29.1 seconds from the measurement start (roughly 30 seconds from tab close), and the process exited with status 0. Cross-compiled Linux, Windows and Intel macOS binaries have not been run on their native operating systems.
