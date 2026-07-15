export function StrategyPreview({ compact = false }: { compact?: boolean }) {
  return <div className={`demo-window strategy-demo ${compact ? "compact" : ""}`} aria-label="Demo of the implemented prediction and strategy engine">
    <header><span>DEMO · QUALIFICATION 42</span><b>MODEL weighted-current-v1</b></header>
    <div className="strategy-score">
      <section><small>OUR ALLIANCE</small><strong>64%</strong><span>confidence 55–73%</span></section>
      <div className="probability-track" aria-label="Demo win probability 64 percent"><i style={{ width: "64%" }} /></div>
      <section><small>WHAT-IF</small><strong>+7%</strong><span>protect auto + one practiced defender</span></section>
    </div>
    <div className="factor-list"><span>KEY FACTORS</span><ol><li><b>+8.4</b><span>Weighted scoring margin</span></li><li><b>+3.1</b><span>Autonomous consistency</span></li><li className="risk"><b>−1.2</b><span>Observed foul exposure</span></li></ol></div>
    {!compact && <footer><div><small>PLAYBOOK PRIORITY</small><strong>Protect cycle consistency; define the missed-auto fallback.</strong></div><span>Decision support, not a guarantee.</span></footer>}
  </div>;
}

export function CadPreview({ compact = false }: { compact?: boolean }) {
  return <div className={`demo-window cad-demo-v2 ${compact ? "compact" : ""}`} aria-label="Demo of the implemented Vantage CAD builder">
    <header><span>DEMO · ENGINEERING THREAD</span><b>SETUP REQUIRED</b></header>
    <div className="cad-demo-body">
      <section><small>CONFIRMED BRIEF</small><h3>Serviceable intake guard</h3><p>Frame perimeter clear · existing 10-32 mounts · inspect interference before export</p><div className="connector-row"><span>Onshape hosted</span><span>Fusion local relay</span></div></section>
      <ol><li className="done"><b>01</b><span>Requirements + assumptions</span><small>Confirmed</small></li><li className="active"><b>02</b><span>Create reviewed action plan</span><small>Approval</small></li><li><b>03</b><span>Geometry + topology checkpoint</span><small>Queued</small></li><li><b>04</b><span>Render / BOM artifact</span><small>Queued</small></li></ol>
    </div>
    {!compact && <footer><span>Human approval required before mutation</span><b>CHECKPOINT 0 / 3</b></footer>}
  </div>;
}

export function CodePreview({ compact = false }: { compact?: boolean }) {
  return <div className={`demo-window code-demo ${compact ? "compact" : ""}`} aria-label="Demo of the implemented FRC code review">
    <header><span>DEMO · DriveSubsystem.java</span><b>PROPOSAL ONLY</b></header>
    <div className="code-demo-body">
      <pre aria-label="Example code diff"><span>@@ periodic() @@</span>{"\n"}<del>- Timer.delay(0.02);</del>{"\n"}<ins>+ // keep command scheduler non-blocking</ins>{"\n"}<ins>+ updateDriveRequest();</ins></pre>
      <aside><span className="risk-label">HIGH RISK</span><h3>Blocking robot loop</h3><p>Blocking calls can starve command scheduling and safety feeds.</p><ul><li>Review CAN IDs and limits</li><li>Run unit/simulation tests</li><li>Test enable/disable transitions</li></ul></aside>
    </div>
    {!compact && <footer><span>Unified diff · source-linked finding</span><b>Human approval required</b></footer>}
  </div>;
}

export function WorkflowStrip() {
  return <ol className="unified-flow" aria-label="Unified Vantage workflow">
    {["Scout", "Predict", "Strategize", "CAD", "Code", "Maintain"].map((stage, index) => <li key={stage}><b>{String(index + 1).padStart(2, "0")}</b><span>{stage}</span>{index < 5 && <i aria-hidden="true" />}</li>)}
  </ol>;
}
