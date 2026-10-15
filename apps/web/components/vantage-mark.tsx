/**
 * The Vantage "V", drawn inline so its dark stroke follows the theme's ink: the navy file
 * (/vantage-mark.svg) nearly vanished on the dark sidebar. The blue accent strokes stay blue.
 */
export function VantageMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 128 128" aria-hidden="true" focusable="false">
      <path d="M12 18h13l39 72 39-72h13L64 114z" fill="var(--ink, #14243a)" />
      <path d="M12 45h13l39 45-7 13zM12 72h13l32 31-7 13z" fill="#1457d9" />
      <rect x="58" y="87" width="12" height="12" fill="#1457d9" />
    </svg>
  );
}
