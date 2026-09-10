// Regenerate the Codex app-server TypeScript bindings from the INSTALLED CLI.
//
// The bindings must match the binary the app actually spawns: the protocol moves between
// releases (0.139 -> 0.154 changed the model cache format and the model list), so a stale
// copy of these types is worse than none.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexBinary, parseVersion } from "../../../scripts/lib/codex-bin.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "src", "generated");

const found = resolveCodexBinary();
if (!found) {
  console.error("[gen:protocol] Codex CLI not found. Install it with: npm i -g @openai/codex@latest");
  process.exit(1);
}
const version = parseVersion(spawnSync(found.path, ["--version"], { encoding: "utf8" }).stdout || "");
console.log(`[gen:protocol] using ${found.source} -> ${found.path} (codex-cli ${version})`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const res = spawnSync(found.path, ["app-server", "generate-ts", "--out", outDir], { encoding: "utf8" });
process.stdout.write(res.stdout || "");
process.stderr.write(res.stderr || "");
if (res.status !== 0) process.exit(res.status ?? 1);
if (!existsSync(path.join(outDir, "index.ts"))) {
  console.error("[gen:protocol] generation produced no index.ts");
  process.exit(1);
}
console.log(`[gen:protocol] wrote bindings for codex-cli ${version} to ${outDir}`);
