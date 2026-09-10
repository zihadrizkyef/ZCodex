// Production launcher: build renderer + TS, then run Electron against the built files.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
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

const electronPath = require("electron");
const electron = spawn(electronPath, [path.join(repo, "apps", "desktop"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ZCODEX_DEV_URL: "" },
});
electron.on("exit", (code) => process.exit(code ?? 0));
