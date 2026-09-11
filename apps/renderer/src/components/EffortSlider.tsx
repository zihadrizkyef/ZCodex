import { useMemo } from "react";

const LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very high",
  max: "Max",
};

export function effortLabel(level: string | null | undefined): string {
  if (!level) return "Default";
  return LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * Effort dial, shaped after Claude Code's own `/effort` control: a Faster ↔ Smarter track with one
 * stop per level the selected model accepts. Dragging (or clicking a stop) applies it immediately.
 */
export function EffortSlider({
  levels,
  value,
  onChange,
}: {
  levels: string[];
  value: string;
  onChange: (level: string) => void;
}): React.ReactElement {
  const stops = useMemo(() => (levels.length ? levels : ["low", "medium", "high", "xhigh", "max"]), [levels]);
  const index = Math.max(0, stops.indexOf(value));

  return (
    <div className="effort-panel">
      <div className="effort-head">
        <span className="effort-title">Effort</span>
        <span className="effort-value">{effortLabel(stops[index])}</span>
      </div>
      <div className="effort-ends">
        <span>Faster</span>
        <span>Smarter</span>
      </div>
      <div className="effort-track">
        <input
          type="range"
          min={0}
          max={Math.max(0, stops.length - 1)}
          step={1}
          value={index}
          aria-label="Effort"
          onChange={(e) => onChange(stops[Number(e.target.value)] ?? stops[0])}
        />
        <div className="effort-ticks" aria-hidden>
          {stops.map((level, i) => (
            <span
              key={level}
              className={`effort-tick${i <= index ? " on" : ""}${i === index ? " current" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}