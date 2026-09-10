// Bundle the preload script.
//
// The window runs with `sandbox: true`, and a sandboxed preload cannot `require()` arbitrary
// modules from disk — it only gets a minimal require (electron + a few builtins). So the preload
// must ship as ONE file with nothing external but electron, or `contextBridge.exposeInMainWorld`
// never runs and `window.zcodex` is undefined.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");

await build({
  entryPoints: [path.join(repo, "apps", "desktop", "src", "preload.ts")],
  outfile: path.join(repo, "apps", "desktop", "dist", "preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: false,
  logLevel: "warning",
});

console.log("[build] preload bundled -> apps/desktop/dist/preload.js");
