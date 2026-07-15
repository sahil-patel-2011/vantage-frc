export function VantageLogo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return <a className={`brand-logo ${compact ? "compact" : ""}`} href={href} aria-label="Vantage">
    <svg aria-hidden="true" viewBox={compact ? "0 0 128 128" : "0 0 640 128"}>
      {compact ? <><path d="M12 16l52 96 52-96H90L64 66 38 16z" fill="currentColor"/><path d="M53 16h22L64 43z" className="logo-accent"/></> : <>
        <g transform="translate(8 8)"><path d="M12 18l52 94 52-94H90L64 68 38 18z" fill="currentColor"/><path d="M53 18h22L64 44z" className="logo-accent"/></g>
        <text x="148" y="86" fill="currentColor" fontFamily="Inter,Arial,sans-serif" fontSize="66" fontWeight="700" letterSpacing="-2">Vantage</text>
      </>}
    </svg>
  </a>;
}
