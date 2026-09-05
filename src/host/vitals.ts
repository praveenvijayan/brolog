import * as os from "node:os";
import type {
  CpuSample,
  MemSample,
  LoadSample,
  NetSample,
} from "../../page/schema";
export type CpuSnapshot = {
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}[];
export function cpuSample(
  previous: CpuSnapshot,
  current: CpuSnapshot,
  timestampMs = Date.now(),
): CpuSample {
  let busy = 0,
    total = 0;
  const cores = current.map((cpu, i) => {
    const before = previous[i];
    if (!before) return 0;
    const delta = Object.keys(cpu.times).reduce(
      (sum, key) =>
        sum +
        Math.max(
          0,
          cpu.times[key as keyof typeof cpu.times] -
            before.times[key as keyof typeof cpu.times],
        ),
      0,
    );
    const active = Math.max(
      0,
      delta - Math.max(0, cpu.times.idle - before.times.idle),
    );
    busy += active;
    total += delta;
    return delta ? (active / delta) * 100 : 0;
  });
  return {
    timestampMs,
    aggregatePercent: total ? (busy / total) * 100 : 0,
    cores,
  };
}
export const memoryPercent = (s: MemSample) =>
  s.totalBytes ? ((s.totalBytes - s.freeBytes) / s.totalBytes) * 100 : 0;
export const memSample = (): MemSample => ({
  timestampMs: Date.now(),
  totalBytes: os.totalmem(),
  freeBytes: os.freemem(),
});
export function loadSample(
  platform: string = os.platform(),
  values = os.loadavg(),
): LoadSample {
  const [load1, load5, load15] =
    platform === "win32" ? [NaN, NaN, NaN] : values;
  return { timestampMs: Date.now(), load1, load5, load15 };
}
export function maskAddress(address: string): string {
  const bare = address.split("%")[0];
  if (bare.includes(".")) return bare.replace(/\.\d+$/, ".x");
  return bare.endsWith("::") ? bare + "x" : bare.replace(/[^:]+$/, "x");
}
export function netSample(): NetSample[] {
  return Object.entries(os.networkInterfaces()).flatMap(([name, items]) =>
    (items ?? []).map((i) => ({
      name,
      family: i.family,
      address: maskAddress(i.address),
      internal: i.internal,
    })),
  );
}
export function systemInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    version: os.version(),
    uptime: os.uptime(),
    cpuModel: cpus[0]?.model ?? "Unknown CPU",
    cpuCount: cpus.length,
    totalmem: os.totalmem(),
  };
}
export type SystemInfo = ReturnType<typeof systemInfo>;
export function sampleInterval(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(250, Math.min(5000, value))
    : 1000;
}
