export default function ProductHome() {
  return (
    <main className="product-home">
      <header className="product-nav"><a className="brand" href="/">VANTAGE</a><nav><a className="display-nav" href="/sign-in" aria-label="Sign in to open TV Display Mode">▣ DISPLAY</a><a href="/sign-in">Secure sign in</a><a href="/admin">Platform admin</a></nav></header>
      <section className="product-command">
        <div><span className="eyebrow">COMPETITION TELEMETRY / COMMAND CENTER</span><h1>Every decision starts from shared evidence.</h1><p>Global reference metrics, source-linked research, private scouting, and controlled AI in one Vantage workspace.</p><a className="home-cta" href="/sign-in">Enter Vantage →</a></div>
        <div className="command-board"><header><span>VANTAGE / SYSTEM STATUS</span><b>READY</b></header><div><article><small>REFERENCE</small><strong>TBA + Statbotics</strong><i /></article><article><small>SCOUTING</small><strong>Offline-capable</strong><i /></article><article><small>RESEARCH</small><strong>Source-aware</strong><i /></article></div><footer><span>Membership</span><strong>Invite only</strong></footer></div>
      </section>
      <section className="product-modules">
        {[
          ["01","TEAM INTEL","Global lookup, hard metrics, qualitative findings, comparisons, trajectory, chemistry, and pick evidence."],
          ["02","SCOUTING","Versioned match and pit forms, confidence, disagreements, media hooks, and offline sync."],
          ["03","RESEARCH","Season-gated shared sweeps plus metered on-demand investigations with provenance."],
          ["04","CONTROL","Platform-only team creation, exact-email invitations, RLS, audit trails, and usage caps."],
        ].map(([number,title,copy])=><article key={number}><span>{number}</span><h2>{title}</h2><p>{copy}</p></article>)}
      </section>
    </main>
  );
}
