import { createGpuReader } from "./gpu";
import { createBridge } from "brobridge";
import * as os from "node:os";
import {
  cpuSample,
  memSample,
  loadSample,
  netSample,
  systemInfo,
  sampleInterval,
} from "./vitals";
import { encodeCpu, encodeMem, encodeLoad, jsonBytes } from "./encode";
export async function startHost(page: string) {
  const bridge = await createBridge({
    index: { body: page, contentType: "text/html" },
  });
  const totals = { payloadBytes: 0, jsonBytes: 0 };
  bridge.expose("system", { info: systemInfo, gpu: createGpuReader() });
  bridge.expose("demo", {
    echo: (value: unknown) => value,
    stats: () => ({ ...totals }),
  });
  for (const name of ["cpu", "mem", "load", "net"] as const)
    bridge.stream("vitals." + name, async (stream, { params }) => {
      let previous = os.cpus(),
        stopped = false;
      void stream.closed.then(
        () => {
          stopped = true;
        },
        () => {
          stopped = true;
        },
      );
      const interval = sampleInterval(params["intervalMs"]);
      while (!stopped) {
        if (name === "cpu") await new Promise((r) => setTimeout(r, interval));
        if (stopped) break;
        const current = name === "cpu" ? os.cpus() : previous;
        const sample =
          name === "cpu"
            ? cpuSample(previous, current)
            : name === "mem"
              ? memSample()
              : name === "load"
                ? loadSample()
                : netSample();
        previous = current;
        const bytes =
          name === "cpu"
            ? encodeCpu(sample as ReturnType<typeof cpuSample>)
            : name === "mem"
              ? encodeMem(sample as ReturnType<typeof memSample>)
              : name === "load"
                ? encodeLoad(sample as ReturnType<typeof loadSample>)
                : new TextEncoder().encode(JSON.stringify(sample));
        await stream.write(bytes);
        totals.payloadBytes += bytes.byteLength;
        totals.jsonBytes += jsonBytes(sample);
        if (name !== "cpu")
          await new Promise((r) =>
            setTimeout(r, interval * (name === "net" ? 5 : 1)),
          );
      }
    });
  return bridge;
}
