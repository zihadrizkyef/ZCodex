// Compile everything (main/preload/packages via tsc, renderer via vite) without launching the app.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const rendererDir = path.join(repo, "apps", "renderer");

function run(command, args, options = {}) {
  const res = spawnSync(command, args, { stdio: "inherit", cwd: repo, ...options });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run(process.execPath, [path.join(repo, "node_modules", "typescript", "bin", "tsc"), "-b"]);
run(process.execPath, [path.join(repo, "scripts", "build-preload.mjs")]);
run(process.execPath, [path.join(repo, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: rendererDir });
console.log("\n✓ build selesai (apps/desktop/dist + apps/renderer/dist)");
