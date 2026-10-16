import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
await mkdir("dist/ui", { recursive: true });
await build({
  stdin: { contents: `export default ${JSON.stringify(manifest)};`, resolveDir: process.cwd(), sourcefile: "manifest.generated.js", loader: "js" },
  bundle: true, platform: "node", format: "esm", outfile: "dist/manifest.js", target: "node24", sourcemap: false,
});
await build({ entryPoints: ["src/worker.ts"], bundle: true, platform: "node", format: "esm", outfile: "dist/worker.js", target: "node24", sourcemap: false });
await build({
  entryPoints: ["src/ui/index.tsx"], bundle: true, platform: "browser", format: "esm", outfile: "dist/ui/index.js", target: "es2022", jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
});
