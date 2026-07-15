import { VantageLogo } from "../../components/brand";

const modules = [
  ["01", "TEAM INTEL", "/intel", "Global lookup, hard metrics, qualitative findings, comparisons, trajectory, chemistry, and pick evidence."],
  ["02", "SCOUTING", "/scouting", "Versioned match and pit forms, confidence, disagreements, media hooks, and offline sync."],
  ["03", "WORKSPACE", "/workspace", "Active-event context, match queue, quick actions, and team controls."],
  ["04", "CAD", "/cad", "Controlled engineering briefs, reviewed mutations, and verified geometry checkpoints."],
];

export default function DashboardPage() {
  return (
    <main className="product-home">
      <header className="product-nav">
        <VantageLogo href="/dashboard" />
        <nav><a className="display-nav" href="/display" aria-label="Open TV Display Mode">▣ DISPLAY</a><a href="/security">Settings</a><a href="/">Public site</a></nav>
      </header>
      <section className="product-command">
        <div><span className="eyebrow">COMPETITION TELEMETRY / COMMAND CENTER</span><h1>Every decision starts from shared evidence.</h1><p>Global reference metrics, source-linked research, private scouting, and controlled AI in one Vantage workspace.</p><a className="home-cta" href="/workspace">Open workspace →</a></div>
        <div className="command-board"><header><span>VANTAGE / SYSTEM STATUS</span><b>READY</b></header><div><article><small>REFERENCE</small><strong>TBA + Statbotics</strong><i /></article><article><small>SCOUTING</small><strong>Offline-capable</strong><i /></article><article><small>RESEARCH</small><strong>Source-aware</strong><i /></article></div><footer><span>Membership</span><strong>Invite only</strong></footer></div>
      </section>
      <section className="product-modules">
        {modules.map(([number, title, href, copy]) => <article key={number}><span>{number}</span><h2><a href={href}>{title}</a></h2><p>{copy}</p></article>)}
      </section>
    </main>
  );
}
