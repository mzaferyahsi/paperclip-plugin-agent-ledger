import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { pluginManifestV1Schema } = require("../node_modules/@paperclipai/shared/dist/validators/plugin.js");
const parsed = pluginManifestV1Schema.parse(JSON.parse(fs.readFileSync("manifest.json", "utf8")));
if (parsed.id !== "mzaferyahsi.agent-ledger") throw new Error("Unexpected plugin id");
if (parsed.jobs?.[0]?.jobKey !== "price-refresh") throw new Error("Expected price-refresh job declaration");
if (!fs.existsSync(`${parsed.database.migrationsDir}/001_init.sql`)) throw new Error("Missing 001_init.sql");
console.log("Manifest valid against the installed Paperclip SDK validator");
