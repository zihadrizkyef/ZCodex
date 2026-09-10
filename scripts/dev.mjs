// Dev launcher: generate bindings (if needed) -> build TS -> Vite dev server -> Electron.
// Every child is spawned as node.exe/electron.exe directly: on Windows, shelling out to
// npm.cmd/npx throws EINVAL and breaks Ctrl-C propagation.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const rendererDir = path.join(repo, "apps", "renderer");
const forwarded = process.argv.slice(2);
const DEBUG_PORT = process.env.ZCODEX_DEBUG_PORT;

function run(command, args, options = {}) {
  const res = spawnSync(command, args, { stdio: "inherit", cwd: repo, ...options });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`Vite tidak siap di port ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

// 1. protocol bindings
if (!existsSync(path.join(repo, "packages", "codex-protocol", "src", "generated", "index.ts"))) {
  console.log("[dev] bindings belum ada — generate dari CLI Codex terpasang…");
  run(process.execPath, [path.join(repo, "packages", "codex-protocol", "scripts", "generate.mjs")]);
}

// 2. main/preload/packages
console.log("[dev] tsc -b …");
run(process.execPath, [path.join(repo, "node_modules", "typescript", "bin", "tsc"), "-b"]);
run(process.execPath, [path.join(repo, "scripts", "build-preload.mjs")]);

// 3. renderer dev server
console.log("[dev] vite dev server…");
const vite = spawn(
  process.execPath,
  [path.join(repo, "node_modules", "vite", "bin", "vite.js"), "--config", path.join(rendererDir, "vite.config.ts")],
  { cwd: rendererDir, stdio: ["ignore", "inherit", "inherit"], env: process.env },
);
vite.on("exit", (code) => {
  if (code !== 0 && code !== null) console.error(`[dev] vite keluar dengan kode ${code}`);
  process.exit(code ?? 0);
});

await waitForPort(5173);

// 4. electron
const electronPath = require("electron");
const electronArgs = [path.join(repo, "apps", "desktop")];
if (DEBUG_PORT) electronArgs.push(`--remote-debugging-port=${DEBUG_PORT}`);
electronArgs.push(...forwarded);
console.log(`[dev] electron ${electronPath} ${electronArgs.join(" ")}`);
const electron = spawn(electronPath, electronArgs, {
  stdio: "inherit",
  env: { ...process.env, ZCODEX_DEV_URL: "http://127.0.0.1:5173" },
});

const shutdown = () => {
  if (!electron.killed) electron.kill();
  if (!vite.killed) vite.kill();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

electron.on("exit", (code) => {
  shutdown();
  process.exit(code ?? 0);
});
