export function VantageLogo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return <a className={`brand-logo ${compact ? "compact" : ""}`} href={href} aria-label="Vantage">
    <svg aria-hidden="true" viewBox={compact ? "0 0 128 128" : "0 0 640 128"}>
      {compact ? <><path d="M12 18h13l39 72 39-72h13L64 114z" fill="currentColor"/><path d="M12 45h13l39 45-7 13zM12 72h13l32 31-7 13z" className="logo-accent"/><rect x="58" y="87" width="12" height="12" className="logo-accent"/></> : <>
        <g transform="translate(4 2)"><path d="M12 18h13l39 72 39-72h13L64 114z" fill="currentColor"/><path d="M12 45h13l39 45-7 13zM12 72h13l32 31-7 13z" className="logo-accent"/><rect x="58" y="87" width="12" height="12" className="logo-accent"/></g>
        <text x="148" y="84" fill="currentColor" fontFamily="Arial,sans-serif" fontSize="58" fontWeight="700" letterSpacing="5">VANTAGE</text>
      </>}
    </svg>
  </a>;
}
