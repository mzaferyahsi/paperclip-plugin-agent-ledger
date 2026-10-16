import { execFileSync } from "node:child_process";

const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const files = JSON.parse(out)[0].files.map((f) => f.path);
for (const required of ["manifest.json", "dist/manifest.js", "dist/worker.js", "dist/ui/index.js", "migrations/001_init.sql", "LICENSE", "README.md"]) {
  if (!files.includes(required)) throw new Error(`Packed artifact is missing ${required}`);
}
console.log(`pack:check ok (${files.length} files)`);
