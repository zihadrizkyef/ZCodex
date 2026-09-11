import type { EngineId, ModelOption } from "./view";

/**
 * Provider engine registry.
 *
 * The UI shows a provider picker (ChatGPT, Claude, …) but the engine underneath is a CLI
 * adapter. Names live here, one place, instead of `engine === "claude" ? "Claude" : "Codex"`
 * scattered across the renderer. Adding a provider = extend the `EngineId` union, add its
 * label here, add an adapter in the main process — no per-engine wording in the UI.
 *
 * NOTE: the codex provider is branded "ChatGPT" in the UI even though the engine binary is
 * the Codex app-server (the internal id stays "codex" so thread-source detection is untouched).
 */
export const ENGINE_LABELS: Record<EngineId, string> = {
  codex: "ChatGPT",
  claude: "Claude",
};

/**
 * Effort levels a given model accepts, in order. Engines write the field they speak natively:
 * Claude fills `effortLevels`, Codex fills `reasoningEfforts`. Present both as one concept so
 * the dial UI never branches on the engine name.
 */
export function engineEffortLevels(model: ModelOption | undefined | null): string[] {
  if (!model) return [];
  if (model.effortLevels && model.effortLevels.length > 0) return model.effortLevels;
  return model.reasoningEfforts ?? [];
}

/**
 * Whether the effort dial should appear. Decided purely by the model's own catalogue data
 * (does it report effort levels?), never by hardcoding an engine name — so any future provider
 * whose CLI reports effort levels gets the dial for free.
 */
export function modelSupportsEffort(model: ModelOption | undefined | null): boolean {
  return engineEffortLevels(model).length > 0;
}