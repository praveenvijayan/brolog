import { test, expect } from "bun:test";
import {
  parseLsof,
  parseSs,
  parseNetstat,
  normalise,
  createPortReader,
  createPortKiller,
} from "../src/host/ports";
import { startHost } from "../src/host/bridge";

const lsof = [
  "p493", "cControlCenter", "Lpv",
  "f9", "PTCP", "n*:7000", "TST=LISTEN",
  "f10", "PTCP", "n*:7000", "TST=LISTEN",
  "f25", "PUDP", "n*:3722",
  "f26", "PUDP", "n*:*",
  "f27", "PUDP", "n192.168.1.5:5353->224.0.0.251:5353",
  "p700", "cmdns", "Lpv",
  "f5", "PUDP", "n192.168.1.185:64988",
  "p800", "cnode", "Lpv",
  "f20", "PTCP", "n127.0.0.1:8080", "TST=LISTEN",
  "f21", "PTCP", "n[::1]:8080", "TST=LISTEN",
].join("\n");

test("lsof fields become one row per process, socket and address", () => {
  const rows = normalise(parseLsof(lsof), 800);
  expect(rows.map((r) => `${r.protocol} ${r.address}:${r.port} ${r.command} ${r.pid}`)).toEqual([
    "udp *:3722 ControlCenter 493",
    "tcp *:7000 ControlCenter 493",
    "tcp ::1:8080 node 800",
    "tcp 127.0.0.1:8080 node 800",
    "udp 192.168.1.x:64988 mdns 700",
  ]);
  expect(rows[2]?.self).toBe(true);
  expect(rows[0]?.self).toBe(false);
  expect(rows[0]?.user).toBe("pv");
});

test("ss rows carry pids from the users column and unknown owners stay listed", () => {
  const rows = normalise(
    parseSs(
      [
        'tcp   LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=800,fd=3),("sshd",pid=801,fd=3))',
        'udp   UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:* users:(("resolved",pid=500,fd=12))',
        "tcp   LISTEN 0 4096 [::]:5432 [::]:*",
        "",
      ].join("\n"),
    ),
    1,
  );
  expect(rows.map((r) => `${r.protocol} ${r.address}:${r.port} ${r.command} ${r.pid}`)).toEqual([
    "tcp *:22 sshd 800",
    "tcp *:22 sshd 801",
    "udp 127.0.0.53:53 resolved 500",
    "tcp *:5432  0",
  ]);
});

test("netstat keeps LISTENING TCP and all UDP rows, naming pids from tasklist", () => {
  const rows = normalise(
    parseNetstat(
      [
        "  Proto  Local Address          Foreign Address        State           PID",
        "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234",
        "  TCP    127.0.0.1:49152        127.0.0.1:49153        ESTABLISHED     1234",
        "  TCP    [::]:135               [::]:0                 LISTENING       1234",
        "  UDP    0.0.0.0:500            *:*                                    9",
      ].join("\r\n"),
      '"svchost.exe","1234","Services","0","12,345 K"\r\n"System","9","Services","0","1 K"',
    ),
    1,
  );
  expect(rows.map((r) => `${r.protocol} ${r.address}:${r.port} ${r.command} ${r.pid}`)).toEqual([
    "tcp *:135 svchost.exe 1234",
    "udp *:500 System 9",
  ]);
});

test("the reader finds brolog's own listener and marks it self", async () => {
  if (process.platform === "win32") return;
  const host = await startHost("<!doctype html><title>test</title>");
  try {
    const reader = createPortReader();
    const sample = await reader();
    expect(sample.source === "lsof" || sample.source === "ss").toBe(true);
    const own = sample.entries.find((e) => e.port === host.port && e.protocol === "tcp");
    expect(own?.pid).toBe(process.pid);
    expect(own?.self).toBe(true);
    expect(own?.address).toBe("127.0.0.1");
  } finally {
    await host.close();
  }
}, 15000);

test("the killer refuses unknown pids, brolog itself and unknown signals", async () => {
  const reader = createPortReader("darwin", 800, async () => lsof);
  await reader();
  const sent: string[] = [];
  const kill = createPortKiller(reader, (pid, signal) => {
    sent.push(`${signal} ${pid}`);
  });
  expect((await kill(493, "HUP")).ok).toBe(false);
  expect((await kill(1, "TERM")).ok).toBe(false);
  expect((await kill("493", "TERM")).ok).toBe(false);
  expect((await kill(4242, "TERM")).message).toBe("Process 4242 is not a listed listener");
  expect((await kill(800, "TERM")).message).toBe("Refusing to kill brolog itself");
  expect(sent).toEqual([]);
  expect(await kill(493, "TERM")).toEqual({ ok: true, message: "Sent SIGTERM to ControlCenter (493)" });
  expect(await kill(493, "KILL")).toEqual({ ok: true, message: "Sent SIGKILL to ControlCenter (493)" });
  expect(sent).toEqual(["SIGTERM 493", "SIGKILL 493"]);
});

test("EPERM and ESRCH are reported, not thrown", async () => {
  const reader = createPortReader("darwin", 1, async () => lsof);
  await reader();
  const failing = (code: string) =>
    createPortKiller(reader, () => {
      throw Object.assign(new Error(code), { code });
    });
  expect((await failing("EPERM")(493, "TERM")).message).toBe(
    "Not permitted to signal ControlCenter (493); it belongs to another user",
  );
  expect((await failing("ESRCH")(493, "TERM")).message).toBe("ControlCenter (493) has already exited");
});

test("a real child listener can be found and terminated", async () => {
  if (process.platform === "win32") return;
  const child = Bun.spawn(
    ["bun", "-e", "Bun.serve({ port: 0, fetch: () => new Response('') }); setInterval(() => {}, 1000)"],
    { stdout: "ignore", stderr: "ignore" },
  );
  const reader = createPortReader();
  try {
    let listed = false;
    for (let i = 0; i < 40 && !listed; i++) {
      reader.invalidate();
      listed = (await reader()).entries.some((e) => e.pid === child.pid);
      if (!listed) await new Promise((r) => setTimeout(r, 250));
    }
    expect(listed).toBe(true);
    const result = await createPortKiller(reader)(child.pid, "TERM");
    expect(result.ok).toBe(true);
    await child.exited;
  } finally {
    child.kill();
  }
}, 20000);
