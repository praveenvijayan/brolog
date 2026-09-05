import { test, expect } from "bun:test";
import {
  cpuSample,
  memoryPercent,
  maskAddress,
  loadSample,
  sampleInterval,
} from "../src/host/vitals";
test("CPU differences use weighted aggregate", () => {
  const before = [
    { times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
    { times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
  ];
  const after = [
    { times: { user: 30, nice: 0, sys: 20, idle: 50, irq: 0 } },
    { times: { user: 0, nice: 0, sys: 0, idle: 200, irq: 0 } },
  ];
  const sample = cpuSample(before, after, 123);
  expect(sample.cores).toEqual([50, 0]);
  expect(sample.aggregatePercent).toBeCloseTo(50 / 3);
  expect(cpuSample(after, after).aggregatePercent).toBe(0);
});
test("memory percent", () =>
  expect(
    memoryPercent({ timestampMs: 0, totalBytes: 100, freeBytes: 25 }),
  ).toBe(75));
test("addresses are masked including compressed IPv6", () => {
  expect(maskAddress("192.168.1.20")).toBe("192.168.1.x");
  expect(maskAddress("fe80::1234%en0")).toBe("fe80::x");
  expect(maskAddress("::")).toBe("::x");
  expect(maskAddress("::1")).toBe("::x");
});
test("Windows load values are NaNs", () => {
  const s = loadSample("win32", [1, 2, 3]);
  expect([s.load1, s.load5, s.load15].every(Number.isNaN)).toBe(true);
});
test("untrusted intervals are bounded", () => {
  expect(sampleInterval(-1)).toBe(250);
  expect(sampleInterval(99999)).toBe(5000);
  expect(sampleInterval("250")).toBe(1000);
  expect(sampleInterval(NaN)).toBe(1000);
});
