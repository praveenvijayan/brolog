import { test, expect } from "bun:test";
import { storageSample, rootPath, createStorageReader } from "../src/host/storage";
test("storage derives used from free so used plus free equals total", () => {
  const sample = storageSample("/", { bsize: 4096, blocks: 1000, bfree: 400, bavail: 350 });
  expect(sample).toEqual({
    path: "/",
    totalBytes: 4096000,
    usedBytes: 2457600,
    availableBytes: 1433600,
  });
});
test("storage rejects impossible or empty filesystems instead of guessing", () => {
  expect(storageSample("/", { bsize: 4096, blocks: 0, bfree: 0, bavail: 0 })).toBe(null);
  expect(storageSample("/", { bsize: 4096, blocks: 10, bfree: 11, bavail: 11 })).toBe(null);
  expect(storageSample("/", { bsize: NaN, blocks: 10, bfree: 1, bavail: 1 })).toBe(null);
});
test("storage root follows the platform", () => {
  expect(rootPath("darwin")).toBe("/");
  expect(rootPath("linux")).toBe("/");
  expect(rootPath("win32")).toBe("C:\\");
  expect(rootPath("win32", "D:")).toBe("D:\\");
});
test("storage reader reports null for a missing path and a sample for the root", async () => {
  expect(await createStorageReader("/definitely/not/a/path")()).toBe(null);
  const sample = await createStorageReader(rootPath())();
  expect(sample?.totalBytes).toBeGreaterThan(0);
  expect((sample?.usedBytes ?? 0) + (sample?.availableBytes ?? 0) <= (sample?.totalBytes ?? 0)).toBe(true);
});
