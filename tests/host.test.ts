import { test, expect } from "bun:test";
import { connect } from "@brobridgejs/client";
import { totalmem } from "node:os";
import { startHost } from "../src/host/bridge";
import { decodeMem } from "../page/schema";
test("fence, one-time bootstrap, unary calls, binary streams and resume", async () => {
  const host = await startHost("<!doctype html><title>test</title>");
  let cookie = "",
    socket: WebSocket | undefined;
  let client: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    expect((await fetch(host.origin)).status).toBe(403);
    client = await connect(host.url, {
      fetch: async (input, init) => {
        const response = await fetch(input, { ...init, redirect: "manual" });
        cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
        return response;
      },
      socket: (url) => {
        // Bun's native WebSocket accepts handshake headers for non-browser tests.
        const Constructor = WebSocket as unknown as new (
          url: string,
          options: { headers: Record<string, string> },
        ) => WebSocket;
        return (socket = new Constructor(url, { headers: { Cookie: cookie } }));
      },
    });
    expect(await client.call("demo.echo", "hello")).toBe("hello");
    expect((await fetch(host.url, { redirect: "manual" })).status).toBe(403);
    expect(
      (
        await fetch(host.origin, {
          headers: { Cookie: cookie, Origin: "https://example.com" },
        })
      ).status,
    ).toBe(403);
    const stream = await client.openStream("vitals.mem", { intervalMs: 250 }),
      iterator = stream[Symbol.asyncIterator]();
    for (let i = 0; i < 3; i++) {
      const next = await iterator.next();
      expect(decodeMem(next.value!).totalBytes).toBe(totalmem());
    }
    const session = client.sessionId;
    socket!.close();
    await new Promise((r) => setTimeout(r, 1200));
    expect(client.sessionId).toBe(session);
    expect(client.state).toBe("open");
    expect(decodeMem((await iterator.next()).value!).totalBytes).toBe(
      totalmem(),
    );
    stream.cancel();
    await iterator.return?.();
  } finally {
    client?.close();
    await host.close();
  }
}, 15000);
