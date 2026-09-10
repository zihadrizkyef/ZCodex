/** Small formatting helpers shared by the sidebar, thread view and composer. */

export function basename(p: string): string {
  if (!p) return "";
  const trimmed = p.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/** Windows-friendly shortening: `C:\a\b\c` -> `C:\…\b\c` when it gets long. */
export function shortenPath(p: string, max = 46): string {
  if (!p || p.length <= max) return p;
  const parts = p.split(/[\\/]/);
  if (parts.length < 3) return p;
  return `${parts[0]}\\…\\${parts.slice(-2).join("\\")}`;
}

export function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}j`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)}h`;
  return new Date(unixSeconds * 1000).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function modelLabel(model: { name: string; defaultReasoningEffort: string | null } | undefined, effortOverride?: string | null): string {
  if (!model) return "Model default";
  const short = model.name.replace(/^GPT-/i, "").replace(/-/g, " ");
  const effort = (effortOverride ?? model.defaultReasoningEffort ?? "medium").toString();
  return `${short} ${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

export function textFromItemText(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
