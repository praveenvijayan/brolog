import { mkdir } from "node:fs/promises";
const result = await Bun.build({
  entrypoints: ["page/app.ts"],
  target: "browser",
  minify: true,
});
if (!result.success) throw new Error(result.logs.join("\n"));
const js = (await result.outputs[0].text()).replace(
  /<\/script/gi,
  "<\\/script",
);
const styles = await Bun.file("page/styles.css").text();
const template = await Bun.file("page/index.html").text();
const html = template
  .replace("<!--CSS-->", () => "<style>" + styles + "</style>")
  .replace("<!--APP-->", () => '<script type="module">' + js + "</script>");
const allowed = "https://github.com/praveenvijayan/brobridge";
if (/https?:\/\//.test(html.replaceAll(allowed, "")))
  throw new Error("External URL in embedded page");
await mkdir("dist", { recursive: true });
await Bun.write("dist/index.html", html);
console.log(
  `Embedded page: ${new TextEncoder().encode(html).byteLength} bytes`,
);
