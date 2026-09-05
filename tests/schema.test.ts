import { test, expect } from "bun:test";
import {
  encodeCpu,
  decodeCpu,
  encodeMem,
  decodeMem,
  encodeLoad,
  decodeLoad,
} from "../page/schema";
test("CPU roundtrip and exact length", () => {
  const s = { timestampMs: 123, aggregatePercent: 42, cores: [1, 2, 3] };
  expect(encodeCpu(s).byteLength).toBe(48);
  expect(decodeCpu(encodeCpu(s))).toEqual(s);
});
test("memory roundtrip and exact length", () => {
  const s = { timestampMs: 123, totalBytes: 123456789, freeBytes: 4567 };
  expect(encodeMem(s).byteLength).toBe(24);
  expect(decodeMem(encodeMem(s))).toEqual(s);
});
test("load roundtrip including NaNs", () => {
  const s = { timestampMs: 123, load1: NaN, load5: 2, load15: 3 };
  expect(encodeLoad(s).byteLength).toBe(32);
  expect(decodeLoad(encodeLoad(s))).toEqual(s);
});
test("unaligned views and malformed lengths", () => {
  const bytes = new Uint8Array(25);
  bytes.set(encodeMem({ timestampMs: 1, totalBytes: 2, freeBytes: 3 }), 1);
  expect(decodeMem(bytes.subarray(1)).totalBytes).toBe(2);
  expect(() => decodeMem(new Uint8Array(23))).toThrow();
  expect(() => decodeCpu(new Uint8Array(16))).toThrow();
});
