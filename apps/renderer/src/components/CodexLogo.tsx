/** Codex-style empty-state mark: two stacked hexagons in outline. */
export function CodexLogo({ size = 48 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M24 4.5 41.5 14.6v20.2L24 45 6.5 34.8V14.6L24 4.5Z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M24 16.2 33.3 21.6v10.8L24 37.8 14.7 32.4V21.6L24 16.2Z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
        opacity="0.55"
      />
    </svg>
  );
}
