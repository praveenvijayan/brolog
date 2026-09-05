import { connect, SnapshotRequiredError } from "@brobridgejs/client";
import {
  decodeCpu,
  decodeMem,
  decodeLoad,
  jsonBytes,
  type NetSample,
} from "./schema";
import type { GpuSample } from "../src/host/gpu";
import type { KillResult, KillSignal, PortEntry, PortSample } from "../src/host/ports";
import type { StorageSample } from "../src/host/storage";
import type { SystemInfo } from "../src/host/vitals";
import { Sparkline } from "./charts";
const el = (id: string) => document.getElementById(id)!;
const show = (id: string, value: string) => {
  el(id).textContent = value;
};
const formatBytes = (n: number) =>
  n >= 1073741824
    ? (n / 1073741824).toFixed(1) + " GiB"
    : n >= 1024
      ? (n / 1024).toFixed(1) + " KiB"
      : n + " B";
const cpuChart = new Sparkline(el("cpu-chart") as HTMLCanvasElement),
  memChart = new Sparkline(el("mem-chart") as HTMLCanvasElement),
  gpuChart = new Sparkline(el("gpu-chart") as HTMLCanvasElement);
function notice(message: string) {
  show("error", message);
  el("error").hidden = false;
}
function log(message: string) {
  const li = document.createElement("li");
  li.textContent = new Date().toLocaleTimeString() + "  " + message;
  el("events").prepend(li);
  while (el("events").children.length > 20) el("events").lastChild?.remove();
}
let socket: WebSocket | null = null,
  paused = false,
  wake: (() => void) | undefined,
  received = 0,
  equivalent = 0,
  generation = 0,
  ports: PortSample = { entries: [], source: null },
  portsKey = "",
  confirming: number | null = null,
  confirmTimer: ReturnType<typeof setTimeout> | undefined;
// Processes sent SIGTERM that are still listed get a force-kill button.
const terminated = new Set<number>();
type Client = Awaited<ReturnType<typeof connect>>;
type Stream = Awaited<ReturnType<Client["openStream"]>>;
const streams = new Set<Stream>();
try {
  const bridge = await connect(location.href, {
    socket: (url) => (socket = new WebSocket(url)),
  });
  function state(value: string) {
    show("state", value);
    if (value !== "open") {
      show("gpu", "—");
      show("gpu-status", "Disconnected");
    }
    show("session", bridge.sessionId?.slice(0, 10) ?? "—");
    log(value + " · " + (bridge.sessionId?.slice(0, 10) ?? "awaiting session"));
    (el("kill") as HTMLButtonElement).disabled = value !== "open";
    renderPorts();
    if (value === "closed")
      notice(
        "The host connection is closed. The app may have exited; relaunch brolog to reconnect.",
      );
  }
  state(bridge.state);
  bridge.on("state", state);
  let gpuPending = false;
  async function updateGpu() {
    if (gpuPending || bridge.state !== "open") return;
    gpuPending = true;
    try {
      const sample = await bridge.call<GpuSample>("system.gpu");
      show("gpu-status", sample.status);
      if (sample.percent === null) {
        show("gpu", "n/a");
        show("gpu-detail", "No driver utilisation counter on this platform");
      } else {
        show("gpu", sample.percent.toFixed(0) + "%");
        show("gpu-detail", "Driver-reported device utilisation · every 1 s");
        gpuChart.add(Date.now(), sample.percent);
      }
    } catch {
      show("gpu", "n/a");
      show("gpu-status", "Unavailable");
      show("gpu-detail", "The host did not answer the GPU probe");
    } finally {
      gpuPending = false;
    }
  }
  void updateGpu();
  setInterval(() => void updateGpu(), 1000);
  let storagePending = false;
  async function updateStorage() {
    if (storagePending || bridge.state !== "open") return;
    storagePending = true;
    try {
      const sample = await bridge.call<StorageSample | null>("system.storage");
      if (!sample) {
        show("storage", "n/a");
        show("storage-detail", "No filesystem statistics on this platform");
        (el("storage-gauge") as HTMLMeterElement).value = 0;
        return;
      }
      const percent = (sample.usedBytes / sample.totalBytes) * 100;
      show("storage", percent.toFixed(1) + "%");
      show(
        "storage-detail",
        formatBytes(sample.usedBytes) +
          " used / " +
          formatBytes(sample.totalBytes) +
          " · " +
          formatBytes(sample.availableBytes) +
          " available",
      );
      show("storage-path", "System volume · " + sample.path);
      (el("storage-gauge") as HTMLMeterElement).value = percent;
    } catch {
      show("storage", "n/a");
      show("storage-detail", "The host did not answer the storage probe");
    } finally {
      storagePending = false;
    }
  }
  void updateStorage();
  setInterval(() => void updateStorage(), 5000);
  function cell(text: string, className?: string) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }
  function renderPorts() {
    const rows = ports.entries;
    if (!rows.length) {
      const td = cell(
        ports.source
          ? "No listening sockets"
          : "Port listing is unavailable on this platform",
      );
      td.colSpan = 7;
      const tr = document.createElement("tr");
      tr.append(td);
      el("ports").replaceChildren(tr);
      return;
    }
    el("ports").replaceChildren(
      ...rows.map((row) => {
        const tr = document.createElement("tr");
        tr.append(
          cell(String(row.port)),
          cell(row.protocol.toUpperCase()),
          cell(row.address),
          cell(row.command || "—"),
          cell(row.pid ? String(row.pid) : "—"),
          cell(row.user || "—"),
        );
        const action = cell("", "action");
        if (row.self) {
          const span = document.createElement("span");
          span.className = "self";
          span.textContent = "this app";
          action.append(span);
        } else if (row.pid) {
          const button = document.createElement("button");
          const armed = confirming === row.pid;
          button.textContent = armed
            ? "Confirm"
            : terminated.has(row.pid)
              ? "Force kill"
              : "Kill";
          button.setAttribute("aria-pressed", String(armed));
          button.setAttribute(
            "aria-label",
            `${button.textContent} ${row.command || "process"} ${row.pid} on port ${row.port}`,
          );
          button.disabled = bridge.state !== "open";
          button.onclick = () => void killPort(row);
          action.append(button);
        }
        tr.append(action);
        return tr;
      }),
    );
  }
  async function killPort(row: PortEntry) {
    clearTimeout(confirmTimer);
    if (confirming !== row.pid) {
      confirming = row.pid;
      confirmTimer = setTimeout(() => {
        confirming = null;
        renderPorts();
      }, 5000);
      renderPorts();
      return;
    }
    confirming = null;
    const signal: KillSignal = terminated.has(row.pid) ? "KILL" : "TERM";
    renderPorts();
    try {
      const result = await bridge.call<KillResult>(
        "system.killPort",
        row.pid,
        signal,
      );
      log(result.message);
      if (result.ok) {
        if (signal === "TERM") terminated.add(row.pid);
        renderPorts();
        setTimeout(() => void updatePorts(), 1500);
      }
    } catch {
      log("The host did not answer the kill request");
    }
  }
  let portsPending = false;
  async function updatePorts() {
    if (portsPending || bridge.state !== "open") return;
    portsPending = true;
    try {
      ports = await bridge.call<PortSample>("system.ports");
      for (const pid of terminated)
        if (!ports.entries.some((e) => e.pid === pid)) terminated.delete(pid);
      show(
        "ports-source",
        ports.source
          ? `${ports.entries.length} sockets via ${ports.source} · every 5 s`
          : "Every 5 s",
      );
      // Rebuild rows only when the listing changed, so a button does not
      // vanish under the pointer or lose focus on every refresh.
      const key = JSON.stringify([ports, [...terminated]]);
      if (key !== portsKey) {
        portsKey = key;
        renderPorts();
      }
    } catch {
      show("ports-source", "The host did not answer the port probe");
    } finally {
      portsPending = false;
    }
  }
  void updatePorts();
  setInterval(() => void updatePorts(), 5000);
  const info = await bridge.call<SystemInfo>("system.info");
  show("hostname", info.hostname);
  show("machine", info.platform + " / " + info.arch);
  show("cpu-model", info.cpuModel + " · " + info.cpuCount + " cores");
  const at = Date.now();
  function uptime() {
    const seconds = Math.floor(info.uptime + (Date.now() - at) / 1000);
    show(
      "uptime",
      `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`,
    );
  }
  uptime();
  setInterval(uptime, 1000);
  show("echo", await bridge.call<string>("demo.echo", "Echo confirmed"));
  async function ping() {
    if (bridge.state !== "open") return;
    try {
      show("ping", (await bridge.ping()).toFixed(1) + " ms");
    } catch {
      show("ping", "—");
    }
  }
  void ping();
  setInterval(() => void ping(), 5000);
  for (const id of ["pause", "interval"])
    (el(id) as HTMLButtonElement).disabled = false;
  el("kill").onclick = () => socket?.close();
  el("pause").onclick = () => {
    paused = !paused;
    el("pause").setAttribute("aria-pressed", String(paused));
    show("pause", paused ? "Resume this stream" : "Pause this stream");
    show(
      "pause-note",
      paused
        ? "Paused. The host blocks when this stream’s remaining credit runs out; the others are not blocked."
        : "Each core shares one stream. Memory and load have their own credit.",
    );
    if (!paused) wake?.();
  };
  function render(name: string, bytes: Uint8Array) {
    let sample: unknown;
    if (name === "cpu") {
      const s = decodeCpu(bytes);
      sample = s;
      show("cpu", s.aggregatePercent.toFixed(1) + "%");
      cpuChart.add(s.timestampMs, s.aggregatePercent);
      el("cores").replaceChildren(
        ...s.cores.map((value, i) => {
          const d = document.createElement("div"),
            label = document.createElement("div"),
            track = document.createElement("div"),
            bar = document.createElement("i");
          label.className = "core-label";
          label.textContent = `CPU ${i + 1} · ${value.toFixed(0)}%`;
          track.className = "core-track";
          bar.style.width = value + "%";
          track.append(bar);
          d.append(label, track);
          return d;
        }),
      );
    } else if (name === "mem") {
      const s = decodeMem(bytes);
      sample = s;
      const percent = ((s.totalBytes - s.freeBytes) / s.totalBytes) * 100;
      show("memory", percent.toFixed(1) + "%");
      show(
        "memory-detail",
        formatBytes(s.totalBytes - s.freeBytes) +
          " used / " +
          formatBytes(s.totalBytes),
      );
      (el("memory-gauge") as HTMLMeterElement).value = percent;
      memChart.add(s.timestampMs, percent);
    } else if (name === "load") {
      const s = decodeLoad(bytes);
      sample = s;
      for (const key of ["load1", "load5", "load15"] as const)
        show(key, Number.isNaN(s[key]) ? "n/a" : s[key].toFixed(2));
      if (Number.isNaN(s.load1)) show("load-note", "n/a on Windows");
    } else {
      const rows = JSON.parse(new TextDecoder().decode(bytes)) as NetSample[];
      sample = rows;
      el("network").replaceChildren(
        ...rows.map((row) => {
          const tr = document.createElement("tr");
          for (const value of [
            row.name,
            row.family,
            row.address,
            row.internal ? "Loopback" : "External",
          ]) {
            const td = document.createElement("td");
            td.textContent = value;
            tr.append(td);
          }
          return tr;
        }),
      );
    }
    received += bytes.byteLength;
    equivalent += jsonBytes(sample);
    show("bytes", formatBytes(received));
    show("json", formatBytes(equivalent));
  }
  async function consume(name: string, epoch: number) {
    let iterator: AsyncIterator<Uint8Array> | undefined,
      stream: Stream | undefined;
    try {
      stream = await bridge.openStream("vitals." + name, {
        intervalMs: Number((el("interval") as HTMLSelectElement).value),
      });
      if (epoch !== generation) {
        stream.cancel();
        return;
      }
      streams.add(stream);
      iterator = stream[Symbol.asyncIterator]();
      while (epoch === generation) {
        if (name === "cpu" && paused)
          await new Promise<void>((r) => {
            wake = r;
          });
        if (epoch !== generation) break;
        const next = await iterator.next();
        if (epoch !== generation || next.done) break;
        if (name === "cpu" && paused)
          await new Promise<void>((r) => {
            wake = r;
          });
        if (epoch !== generation) break;
        render(name, next.value);
      }
    } catch (error) {
      if (epoch !== generation) return;
      if (error instanceof SnapshotRequiredError) {
        cpuChart.clear();
        memChart.clear();
        log("Replay expired; starting fresh samples");
        restart();
      } else
        notice(
          "Stream interrupted. " +
            (bridge.state === "closed"
              ? "Relaunch brolog."
              : "Waiting for the bridge; change the interval to retry."),
        );
    } finally {
      if (stream) {
        streams.delete(stream);
        stream.cancel();
      }
      await iterator?.return?.().catch(() => {});
    }
  }
  function restart() {
    generation++;
    wake?.();
    for (const stream of streams) stream.cancel();
    streams.clear();
    for (const name of ["cpu", "mem", "load", "net"])
      void consume(name, generation);
  }
  el("interval").onchange = restart;
  restart();
  window.addEventListener("pagehide", () => bridge.close());
} catch {
  notice(
    "Could not connect. The launch token may be used or expired, or the host is unavailable. Relaunch brolog for a fresh launch URL.",
  );
  show("state", "closed");
}
