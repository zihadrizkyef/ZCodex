// Dev launcher: starts the harness server + the Vite GUI together, so
// `npm run dev` at the repo root is the whole dev loop. Ctrl-C (SIGINT) stops both.
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guiDir = path.join(root, 'apps', 'gui');

const children = [];

function start(name, args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  child.stdout?.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Harness server (WS bridge on 127.0.0.1:4123) from the built output.
start('server', [path.join(root, 'apps', 'harness-server', 'dist', 'index.js')], root);

// Vite dev server for the GUI — invoke vite's CLI directly via node (no shell shim needed).
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteBin)) {
  console.error('vite not found — run `npm install` first.');
  shutdown(1);
}
start('gui', [viteBin], guiDir);

console.log('zcodex dev — harness server + GUI. Open http://localhost:5173/  (Ctrl-C to stop)');