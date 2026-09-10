import { spawn, SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

const WIN_EXT = ['', '.exe', '.cmd', '.bat'];

/**
 * Resolve a bare command name to an absolute path on PATH. On Windows also probes npm-global bin
 * dirs, because background/daemon processes may inherit a PATH that lacks them. Returns absolute
 * path or null if not found.
 */
export function resolveCli(cmd: string): string | null {
  if (cmd.includes('/') || cmd.includes('\\')) return existsSync(cmd) ? cmd : null;
  const dirs = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    // npm generates its global shims here; the server process PATH sometimes drops it.
    .concat(
      process.platform === 'win32'
        ? [
            path.join(process.env.APPDATA ?? '', 'npm'),
            path.join(process.env.LOCALAPPDATA ?? '', 'npm'),
            path.join(process.env.HOME ?? '', 'AppData', 'Roaming', 'npm'),
            path.join(process.env.HOME ?? '', '.local', 'bin'),
          ]
        : [],
    );
  const exts = process.platform === 'win32' ? WIN_EXT : [''];
  for (const dir of dirs) {
    const base = path.join(dir, cmd);
    for (const ext of exts) {
      const candidate = base + ext;
      // Skip a bare extensionless file if it's a #! shell script (Node can't exec it on Windows).
      if (existsSync(candidate) && candidate !== base) return candidate;
    }
    if (process.platform !== 'win32') {
      const bare = path.join(dir, cmd);
      if (existsSync(bare)) return bare;
    }
  }
  return null;
}

/**
 * Spawn a coding-agent CLI so it resolves everywhere, including the Windows npm shim situation:
 * a bare name on PATH may be an extensionless bash script (Node can't exec it) or a `.cmd` stub
 * (needs cmd.exe). We resolve to an absolute path; native `.exe` is spawned directly, `.cmd`/`.bat`
 * via cmd.exe (shell:true). Non-Windows spawns directly.
 */
export function spawnCli(cmd: string, args: string[], opts: SpawnOptions = {}): ReturnType<typeof spawn> {
  const resolved = resolveCli(cmd) ?? cmd;
  if (process.platform === 'win32') {
    const ext = path.extname(resolved).toLowerCase();
    const needShell = ext === '.cmd' || ext === '.bat' || ext === '';
    return spawn(resolved, args, { ...opts, shell: needShell });
  }
  return spawn(resolved, args, { ...opts, shell: false });
}