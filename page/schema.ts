export interface CpuSample {
  timestampMs: number;
  aggregatePercent: number;
  cores: number[];
}
export interface MemSample {
  timestampMs: number;
  totalBytes: number;
  freeBytes: number;
}
export interface LoadSample {
  timestampMs: number;
  load1: number;
  load5: number;
  load15: number;
}
export interface NetSample {
  name: string;
  family: string;
  address: string;
  internal: boolean;
}
const pack = (values: number[]) =>
  new Uint8Array(new Float64Array(values).buffer);
function unpack(bytes: Uint8Array, length?: number): Float64Array {
  if (
    bytes.byteLength % 8 ||
    (length !== undefined && bytes.byteLength !== length * 8)
  )
    throw new Error("Invalid sample length");
  return new Float64Array(bytes.slice().buffer);
}
export const encodeCpu = (s: CpuSample) =>
  pack([s.timestampMs, s.aggregatePercent, s.cores.length, ...s.cores]);
export function decodeCpu(b: Uint8Array): CpuSample {
  const a = unpack(b);
  if (a.length < 3 || a[2] !== a.length - 3)
    throw new Error("Invalid CPU sample");
  return {
    timestampMs: a[0],
    aggregatePercent: a[1],
    cores: Array.from(a.slice(3)),
  };
}
export const encodeMem = (s: MemSample) =>
  pack([s.timestampMs, s.totalBytes, s.freeBytes]);
export function decodeMem(b: Uint8Array): MemSample {
  const a = unpack(b, 3);
  return { timestampMs: a[0], totalBytes: a[1], freeBytes: a[2] };
}
export const encodeLoad = (s: LoadSample) =>
  pack([s.timestampMs, s.load1, s.load5, s.load15]);
export function decodeLoad(b: Uint8Array): LoadSample {
  const a = unpack(b, 4);
  return { timestampMs: a[0], load1: a[1], load5: a[2], load15: a[3] };
}
export const jsonBytes = (sample: unknown) =>
  new TextEncoder().encode(JSON.stringify(sample)).byteLength;
