import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";

/** Oldest Codex CLI this app is known to work against. */
export const MIN_SUPPORTED_CODEX_VERSION = "0.154.0";

export interface CodexCandidate {
  path: string;
  source: string;
}

export interface ResolvedCodex {
  path: string;
  source: string;
  version: string | null;
  /** Other runnable Codex binaries found on this machine (for diagnostics). */
  alternatives: Array<{ path: string; source: string; version: string | null }>;
}

function safeDirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function binaryInPackage(pkgDir: string, exeName: string): string | null {
  for (const target of safeDirs(path.join(pkgDir, "vendor"))) {
    const bin = path.join(pkgDir, "vendor", target, "bin", exeName);
    if (existsSync(bin)) return bin;
  }
  // npm sometimes nests the platform package one level deeper
  for (const nested of [`node_modules/@openai`, "node_modules"]) {
    const dir = path.join(pkgDir, nested);
    for (const name of safeDirs(dir)) {
      if (!name.startsWith("codex")) continue;
      const found = binaryInPackage(path.join(dir, name), exeName);
      if (found) return found;
    }
  }
  return null;
}

/** The npm install layout is always `node_modules/@openai/codex*` — look there, nothing wider. */
function findNpmInstalls(root: string, exeName: string): string[] {
  const out: string[] = [];
  const scope = path.join(root, "@openai");
  for (const name of safeDirs(scope)) {
    if (!name.startsWith("codex")) continue;
    const found = binaryInPackage(path.join(scope, name), exeName);
    if (found) out.push(found);
  }
  return out;
}

function pathEntries(): string[] {
  return [
    ...(process.env.PATH || "").split(path.delimiter),
    path.join(process.env.APPDATA || "", "npm"),
    path.join(process.env.LOCALAPPDATA || "", "npm"),
    path.join(os.homedir(), ".local", "bin"),
  ].filter(Boolean);
}

/**
 * Every runnable Codex CLI binary we know how to find, most trustworthy first.
 *
 * Node cannot exec the extensionless npm shims (nor `.cmd` without a shell), so we deliberately
 * look for the real `codex.exe` inside `@openai/codex-<platform>/vendor/<target>/bin`.
 */
export function listCodexCandidates(extraCandidates: string[] = []): CodexCandidate[] {
  const exeName = WIN ? "codex.exe" : "codex";
  const candidates: CodexCandidate[] = [];
  const push = (p: string, source: string): void => {
    try {
      if (p && existsSync(p) && statSync(p).isFile() && !candidates.some((c) => c.path === p)) {
        candidates.push({ path: p, source });
      }
    } catch {
      /* unreadable path — skip */
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
    for (const found of findNpmInstalls(root, exeName)) push(found, `npm:${root}`);
  }
  if (process.env.LOCALAPPDATA) {
    push(path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", exeName), "Codex Desktop bundle");
  }
  return candidates;
}

export function parseVersion(output: string): string | null {
  const m = String(output).match(/(\d+\.\d+\.\d+[\w.-]*)/);
  return m ? m[1] : null;
}

/** `codex --version` -> "0.154.0" (null when the binary cannot be probed). */
export function getCodexVersion(binaryPath: string): string | null {
  try {
    const res = spawnSync(binaryPath, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
    return parseVersion(res.stdout || res.stderr || "");
  } catch {
    return null;
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Pick the binary to actually run: the NEWEST working one.
 *
 * A machine can easily hold several (npm global, project-local, the copy bundled with Codex
 * Desktop). Picking the first hit by path order silently runs an outdated CLI, and an outdated
 * CLI is rejected by the server ("requires a newer version of Codex"), so we probe them all.
 */
export function resolveCodexBinary(extraCandidates: string[] = []): ResolvedCodex | null {
  const probed = listCodexCandidates(extraCandidates).map((candidate) => ({
    ...candidate,
    version: getCodexVersion(candidate.path),
  }));
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
