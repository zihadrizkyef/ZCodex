// One-time setup: verify the Codex CLI, then generate protocol bindings from it.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexBinary, parseVersion, compareVersions } from "./lib/codex-bin.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const MIN_VERSION = "0.154.0";

const found = resolveCodexBinary();
if (!found) {
  console.error("✗ Codex CLI tidak ketemu. Install dulu:\n    npm i -g @openai/codex@latest");
  process.exit(1);
}
const version = parseVersion(spawnSync(found.path, ["--version"], { encoding: "utf8" }).stdout || "");
console.log(`✓ Codex CLI ${version} (${found.source})\n  ${found.path}`);
if (version && compareVersions(version, MIN_VERSION) < 0) {
  console.error(
    `\n✗ Versi ${version} terlalu tua (butuh >= ${MIN_VERSION}).\n` +
      "  Server akan menolak model terbaru: 'requires a newer version of Codex'.\n" +
      "  Jalankan: npm i -g @openai/codex@latest",
  );
  process.exit(1);
}

const generated = path.join(repo, "packages", "codex-protocol", "src", "generated", "index.ts");
if (!existsSync(generated)) {
  console.log("\n→ Generate protocol bindings…");
  const res = spawnSync(process.execPath, [path.join(repo, "packages", "codex-protocol", "scripts", "generate.mjs")], {
    stdio: "inherit",
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
} else {
  console.log("\n✓ Protocol bindings sudah ada (npm run gen:protocol buat regenerasi).");
}
