import { mkdir, stat } from "node:fs/promises";
await import("./build-page");
await mkdir("release", { recursive: true });
const targets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "windows-x64",
];
const selected = process.argv.slice(2);
if (selected.some((t) => !targets.includes(t)))
  throw new Error("Unknown target");
for (const target of selected.length ? selected : targets) {
  const output = `release/brolog-${target}${target.startsWith("windows") ? ".exe" : ""}`;
  const child = Bun.spawn(
    [
      "bun",
      "build",
      "--compile",
      "--minify",
      "--bytecode",
      `--target=bun-${target}`,
      "./src/host/main.ts",
      "--outfile",
      output,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0) throw new Error(`Build failed: ${target}`);
  console.log(
    `${output}: ${((await stat(output)).size / 1024 / 1024).toFixed(1)} MiB`,
  );
}
