import { statfs } from "node:fs/promises";

export interface StorageSample {
  path: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}
export interface StorageStats {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}

// Root of the system volume. On macOS the root statfs reports the whole APFS
// container, which is the number users compare with Finder and df.
export const rootPath = (platform = process.platform, systemDrive?: string) =>
  platform === "win32" ? (systemDrive || "C:") + "\\" : "/";

// bfree counts blocks free to root; bavail excludes reserved blocks. Used is
// derived from bfree so used + free equals total, and available is what the
// user can actually write.
export function storageSample(path: string, stats: StorageStats): StorageSample | null {
  const { bsize, blocks, bfree, bavail } = stats;
  if (![bsize, blocks, bfree, bavail].every((n) => Number.isFinite(n) && n >= 0)) return null;
  const totalBytes = blocks * bsize;
  if (totalBytes <= 0 || bfree > blocks) return null;
  return {
    path,
    totalBytes,
    usedBytes: (blocks - bfree) * bsize,
    availableBytes: Math.min(bavail, bfree) * bsize,
  };
}

// Cache and coalesce across tabs. Storage moves slowly; five seconds is plenty.
export function createStorageReader(path = rootPath(process.platform, process.env["SystemDrive"])) {
  let pending: Promise<StorageSample | null> | undefined;
  let cached: StorageSample | null = null;
  let sampledAt = 0;
  return (): Promise<StorageSample | null> => {
    if (pending) return pending;
    if (Date.now() - sampledAt < 5000) return Promise.resolve(cached);
    pending = statfs(path)
      .then((stats) => storageSample(path, stats), () => null)
      .then((sample) => {
        cached = sample;
        sampledAt = Date.now();
        pending = undefined;
        return sample;
      });
    return pending;
  };
}
