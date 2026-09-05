import { test, expect } from "bun:test";
import { parseGpuUsage, createGpuReader } from "../src/host/gpu";
test("GPU reports active and idle without confusing missing counters with zero", () => {
  expect(parseGpuUsage('"Device Utilization %"=30')).toEqual({percent:30,status:"Active"});
  expect(parseGpuUsage('"Device Utilization %"=0')).toEqual({percent:0,status:"Idle"});
  expect(parseGpuUsage('"Renderer Utilization %"=20')).toEqual({percent:null,status:"Unavailable"});
  expect(parseGpuUsage('"Device Utilization %"=101')).toEqual({percent:null,status:"Unavailable"});
});
test("GPU uses busiest device when multiple accelerators report counters", () => {
  expect(parseGpuUsage('"Device Utilization %"=15 "Device Utilization %"=65').percent).toBe(65);
});
test("unsupported platforms explicitly report unavailable", async () => {
  expect(await createGpuReader("linux")()).toEqual({percent:null,status:"Unavailable"});
});
