// Minimal declarations for the runtime APIs this app uses. Keep the dependency
// budget at the two bridge packages and TypeScript; no ambient `any` shims.
declare const process: {
  platform: string;
  argv: string[];
  env: Record<string, string | undefined>;
  on(event: string, listener: () => void): void;
  exit(code: number): never;
};
declare const Bun: {
  build(options: {
    entrypoints: string[];
    target: "browser";
    minify: boolean;
  }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
  file(path: string): { text(): Promise<string> };
  write(path: string, body: string): Promise<number>;
  spawn(
    argv: string[],
    options: { stdout: "inherit" | "ignore"; stderr: "inherit" | "ignore" },
  ): { exited: Promise<number> };
};
declare module "*.html" {
  const text: string;
  export default text;
}
declare module "node:fs/promises" {
  export function mkdir(
    path: string,
    options: { recursive: boolean },
  ): Promise<string | undefined>;
  export function stat(path: string): Promise<{ size: number }>;
  export function statfs(
    path: string,
  ): Promise<{ bsize: number; blocks: number; bfree: number; bavail: number }>;
}
declare module "node:os" {
  export function cpus(): {
    model: string;
    speed: number;
    times: {
      user: number;
      nice: number;
      sys: number;
      idle: number;
      irq: number;
    };
  }[];
  export function totalmem(): number;
  export function freemem(): number;
  export function loadavg(): number[];
  export function platform(): string;
  export function arch(): string;
  export function hostname(): string;
  export function release(): string;
  export function version(): string;
  export function uptime(): number;
  export function networkInterfaces(): Record<
    string,
    { family: string; address: string; internal: boolean }[] | undefined
  >;
}
declare module "bun:test" {
  export function test(
    name: string,
    body: () => void | Promise<void>,
    timeout?: number,
  ): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toBeGreaterThan(expected: number): void;
    toThrow(): void;
  };
}

declare module "node:child_process" {
  export function execFile(file: string, args: string[], options: {timeout: number; maxBuffer: number}, callback: (error: Error | null, stdout: string, stderr: string) => void): void;
}
