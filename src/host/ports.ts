import { execFile } from "node:child_process";
import { maskAddress } from "./vitals";

export interface PortEntry {
  protocol: "tcp" | "udp";
  port: number;
  address: string;
  pid: number;
  command: string;
  user: string;
  /** True when the socket belongs to this brolog process. */
  self: boolean;
}
export interface PortSample {
  entries: PortEntry[];
  /** Which tool produced the sample; null when nothing could be read. */
  source: "lsof" | "ss" | "netstat" | null;
}
export type KillSignal = "TERM" | "KILL";
export interface KillResult {
  ok: boolean;
  message: string;
}

type RawEntry = Omit<PortEntry, "self">;
const validPort = (port: number) =>
  Number.isInteger(port) && port > 0 && port <= 65535;

// `lsof -F pcPnL` prints one field per line. Process fields (p, c, L) apply to
// every file that follows until the next `p`. Only the local endpoint is kept;
// connected UDP sockets (with `->`) are traffic, not services.
export function parseLsof(output: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let pid = 0,
    command = "",
    user = "",
    protocol: RawEntry["protocol"] | null = null;
  for (const line of output.split("\n")) {
    const value = line.slice(1);
    switch (line[0]) {
      case "p":
        pid = Number(value);
        command = user = "";
        break;
      case "c":
        command = value;
        break;
      case "L":
        user = value;
        break;
      case "P":
        protocol = value === "TCP" ? "tcp" : value === "UDP" ? "udp" : null;
        break;
      case "n": {
        if (!protocol || value.includes("->")) break;
        const local = splitEndpoint(value);
        if (local) entries.push({ protocol, ...local, pid, command, user });
      }
    }
  }
  return entries;
}

// `ss -Hlntup`: netid, state, queues, local, peer, then an optional
// users:(("cmd",pid=N,fd=M),...) column. Without permission for another user's
// process the column is absent and the pid is unknown.
export function parseSs(output: string): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const line of output.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5) continue;
    const protocol =
      fields[0] === "tcp" ? "tcp" : fields[0] === "udp" ? "udp" : null;
    const local = protocol && splitEndpoint(fields[4]);
    if (!local) continue;
    const owners = [...line.matchAll(/\("([^"]*)",pid=(\d+)/g)];
    if (!owners.length)
      entries.push({ protocol, ...local, pid: 0, command: "", user: "" });
    for (const [, command, pid] of owners)
      entries.push({ protocol, ...local, pid: Number(pid), command, user: "" });
  }
  return entries;
}

// `netstat -ano` prints TCP rows with a state column and UDP rows without.
// `tasklist /fo csv /nh` supplies names: "image","pid","session",...
export function parseNetstat(output: string, tasklist = ""): RawEntry[] {
  const names = new Map<number, string>();
  for (const row of tasklist.split("\n")) {
    const match = row.match(/^"([^"]*)","(\d+)"/);
    if (match) names.set(Number(match[2]), match[1]);
  }
  const entries: RawEntry[] = [];
  for (const line of output.split("\n")) {
    const fields = line.trim().split(/\s+/);
    const protocol =
      fields[0] === "TCP" ? "tcp" : fields[0] === "UDP" ? "udp" : null;
    if (!protocol) continue;
    const pid = Number(fields[protocol === "tcp" ? 4 : 3]);
    if (protocol === "tcp" && fields[3] !== "LISTENING") continue;
    const local = splitEndpoint(fields[1]);
    if (!local || !Number.isInteger(pid)) continue;
    entries.push({
      protocol,
      ...local,
      pid,
      command: names.get(pid) ?? "",
      user: "",
    });
  }
  return entries;
}

function splitEndpoint(text: string): { address: string; port: number } | null {
  const at = text.lastIndexOf(":");
  if (at < 0) return null;
  const port = Number(text.slice(at + 1));
  if (!validPort(port)) return null;
  const address = text.slice(0, at).replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "");
  return { address: presentAddress(address), port };
}

// Wildcards and loopback are shown as-is; a socket bound to a specific
// interface gets the same masking as the network panel.
function presentAddress(address: string): string {
  if (address === "0.0.0.0" || address === "::" || address === "*") return "*";
  if (address === "127.0.0.1" || address === "::1" || address.startsWith("127."))
    return address;
  return maskAddress(address);
}

// Collapse the IPv4 and IPv6 sockets a server usually binds together, then
// order by port so the table is stable between refreshes.
export function normalise(entries: RawEntry[], selfPid: number): PortEntry[] {
  const seen = new Map<string, PortEntry>();
  for (const entry of entries) {
    const key = `${entry.protocol}/${entry.address}:${entry.port}/${entry.pid}`;
    const previous = seen.get(key);
    if (previous) {
      previous.command ||= entry.command;
      previous.user ||= entry.user;
    } else seen.set(key, { ...entry, self: entry.pid === selfPid });
  }
  return [...seen.values()].sort(
    (a, b) =>
      a.port - b.port ||
      a.protocol.localeCompare(b.protocol) ||
      a.address.localeCompare(b.address) ||
      a.pid - b.pid,
  );
}

type Runner = (file: string, args: string[]) => Promise<string>;
const run: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 4000, maxBuffer: 8 * 1024 * 1024 },
      // lsof exits 1 when one of its selectors matched nothing; the rest of
      // the listing is still on stdout.
      (error, stdout) => (stdout ? resolve(stdout) : reject(error ?? new Error("empty"))),
    );
  });

async function probe(platform: string, exec: Runner): Promise<{ entries: RawEntry[]; source: PortSample["source"] }> {
  if (platform === "darwin")
    return {
      source: "lsof",
      entries: parseLsof(
        await exec("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-iUDP", "-F", "pcPnL"]),
      ),
    };
  if (platform === "linux")
    return { source: "ss", entries: parseSs(await exec("ss", ["-Hlntup"])) };
  if (platform === "win32") {
    const [netstat, tasklist] = await Promise.all([
      exec("netstat", ["-ano"]),
      exec("tasklist", ["/fo", "csv", "/nh"]).catch(() => ""),
    ]);
    return { source: "netstat", entries: parseNetstat(netstat, tasklist) };
  }
  throw new Error("unsupported platform");
}

// Cache and coalesce across tabs, like the storage reader. `invalidate` lets a
// kill show its effect on the next call instead of five seconds later.
export function createPortReader(
  platform = process.platform,
  selfPid = process.pid,
  exec: Runner = run,
) {
  let pending: Promise<PortSample> | undefined;
  let cached: PortSample = { entries: [], source: null };
  let sampledAt = 0;
  const read = (): Promise<PortSample> => {
    if (pending) return pending;
    if (Date.now() - sampledAt < 5000) return Promise.resolve(cached);
    pending = probe(platform, exec)
      .then(
        ({ entries, source }): PortSample => ({ entries: normalise(entries, selfPid), source }),
        (): PortSample => ({ entries: [], source: null }),
      )
      .then((sample) => {
        cached = sample;
        sampledAt = Date.now();
        pending = undefined;
        return sample;
      });
    return pending;
  };
  read.invalidate = () => {
    sampledAt = 0;
  };
  read.last = () => cached;
  return read;
}

// A tab may only signal a process it was shown as a listener, never brolog
// itself, and only with the two signals the UI offers. Errors are returned as
// a result rather than thrown: the bridge reduces thrown errors to "internal
// error", and the user needs to see EPERM.
export function createPortKiller(
  reader: ReturnType<typeof createPortReader>,
  kill: (pid: number, signal: string) => void = (pid, signal) => {
    process.kill(pid, signal);
  },
) {
  return async (pid: unknown, signal: unknown): Promise<KillResult> => {
    if (signal !== "TERM" && signal !== "KILL")
      return { ok: false, message: "Unknown signal" };
    if (!Number.isInteger(pid) || (pid as number) <= 1)
      return { ok: false, message: "Invalid process id" };
    const entry = reader.last().entries.find((e) => e.pid === pid);
    if (!entry) return { ok: false, message: `Process ${pid} is not a listed listener` };
    if (entry.self) return { ok: false, message: "Refusing to kill brolog itself" };
    const label = `${entry.command || "pid " + pid} (${pid})`;
    try {
      kill(pid as number, "SIG" + signal);
    } catch (error) {
      const code = (error as { code?: string }).code;
      return {
        ok: false,
        message:
          code === "EPERM"
            ? `Not permitted to signal ${label}; it belongs to another user`
            : code === "ESRCH"
              ? `${label} has already exited`
              : `Could not signal ${label}`,
      };
    }
    reader.invalidate();
    console.log(`sent SIG${signal} to ${label}`);
    return { ok: true, message: `Sent SIG${signal} to ${label}` };
  };
}
