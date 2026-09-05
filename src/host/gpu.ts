import { execFile } from "node:child_process";

export interface GpuSample {
  percent: number | null;
  status: "Active" | "Idle" | "Unavailable";
}
const unavailable = (): GpuSample => ({ percent: null, status: "Unavailable" });

// IOAccelerator publishes driver-reported device utilisation. Never substitute
// renderer/tiler counters: they measure different work and can overlap.
export function parseGpuUsage(output: string): GpuSample {
  const values = [...output.matchAll(/"Device Utilization %"\s*=\s*(\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);
  if (!values.length) return unavailable();
  const percent = Math.max(...values);
  return { percent, status: percent > 0 ? "Active" : "Idle" };
}

// Cache and coalesce requests across tabs; never launch overlapping probes.
export function createGpuReader(platform = process.platform) {
  let pending: Promise<GpuSample> | undefined;
  let cached = unavailable();
  let sampledAt = 0;
  return (): Promise<GpuSample> => {
    if (platform !== "darwin") return Promise.resolve(unavailable());
    if (pending) return pending;
    if (Date.now() - sampledAt < 1000) return Promise.resolve(cached);
    pending = new Promise<GpuSample>((resolve) => {
      execFile("/usr/sbin/ioreg", ["-r", "-c", "IOAccelerator", "-l", "-d", "1"],
        { timeout: 1500, maxBuffer: 1024 * 1024 },
        (error, stdout) => resolve(error ? unavailable() : parseGpuUsage(stdout)));
    }).then((sample) => {
      cached = sample;
      sampledAt = Date.now();
      pending = undefined;
      return sample;
    });
    return pending;
  };
}
