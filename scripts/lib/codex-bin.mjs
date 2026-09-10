// Shared helper: find a runnable Codex CLI binary on this machine.
// Node cannot exec the extensionless npm shims on Windows, so we resolve to the native
// `codex.exe` that ships inside @openai/codex-<platform>/vendor/<target>/bin.
//
// A machine often holds several copies (npm global, project-local, the one bundled with Codex
// Desktop). We probe each with `--version` and return the NEWEST — an outdated CLI is rejected by
// the server, so "first hit wins" silently breaks the app.
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";

function safeDirs(p) {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function binaryInPackage(pkgDir, exeName) {
  for (const target of safeDirs(path.join(pkgDir, "vendor"))) {
    const bin = path.join(pkgDir, "vendor", target, "bin", exeName);
    if (existsSync(bin)) return bin;
  }
  for (const nested of [path.join("node_modules", "@openai"), "node_modules"]) {
    const dir = path.join(pkgDir, nested);
    for (const name of safeDirs(dir)) {
      if (!name.startsWith("codex")) continue;
      const found = binaryInPackage(path.join(dir, name), exeName);
      if (found) return found;
    }
  }
  return null;
}

function pathEntries() {
  return [
    ...(process.env.PATH || "").split(path.delimiter),
    path.join(process.env.APPDATA || "", "npm"),
    path.join(process.env.LOCALAPPDATA || "", "npm"),
    path.join(os.homedir(), ".local", "bin"),
  ].filter(Boolean);
}

/** @returns {Array<{path: string, source: string}>} most trustworthy first */
export function listCodexCandidates(extraCandidates = []) {
  const exeName = WIN ? "codex.exe" : "codex";
  const candidates = [];
  const push = (p, source) => {
    try {
      if (p && existsSync(p) && statSync(p).isFile() && !candidates.some((c) => c.path === p)) {
        candidates.push({ path: p, source });
      }
    } catch {
      /* skip unreadable */
    }
  };

  if (process.env.CODEX_BIN) push(process.env.CODEX_BIN, "CODEX_BIN env");
  for (const c of extraCandidates) push(c, "explicit");
  for (const p of pathEntries()) push(path.join(p, exeName), `PATH:${p}`);
  for (const root of [
    path.join(process.cwd(), "node_modules"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm", "node_modules") : "",
  ]) {
    if (!root) continue;
    const scope = path.join(root, "@openai");
    for (const name of safeDirs(scope)) {
      if (!name.startsWith("codex")) continue;
      const found = binaryInPackage(path.join(scope, name), exeName);
      if (found) push(found, `npm:${root}`);
    }
  }
  if (process.env.LOCALAPPDATA) {
    push(path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", exeName), "Codex Desktop bundle");
  }
  return candidates;
}

/** Parse `codex --version` output ("codex-cli 0.154.0") into a plain version string. */
export function parseVersion(stdout) {
  const m = String(stdout).match(/(\d+\.\d+\.\d+[\w.-]*)/);
  return m ? m[1] : null;
}

export function getCodexVersion(binaryPath) {
  try {
    const res = spawnSync(binaryPath, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    return parseVersion(res.stdout || res.stderr || "");
  } catch {
    return null;
  }
}

export function compareVersions(a, b) {
  const pa = String(a).split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** @returns {{path: string, source: string, version: string|null, alternatives: Array<{path: string, source: string, version: string|null}>}|null} */
export function resolveCodexBinary(extraCandidates = []) {
  const probed = listCodexCandidates(extraCandidates).map((c) => ({ ...c, version: getCodexVersion(c.path) }));
  const runnable = probed.filter((c) => c.version);
  const pool = runnable.length > 0 ? runnable : probed;
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => compareVersions(b.version ?? "0", a.version ?? "0"));
  const best = sorted[0];
  return {
    path: best.path,
    source: best.source,
    version: best.version,
    alternatives: sorted.slice(1).map(({ path: p, source, version }) => ({ path: p, source, version })),
  };
}
