import { reviewFrcCode } from "@vantage/agent";

const sample = `public void periodic() {
  Timer.delay(0.02);
  driveMotor.set(3);
}`;
const review = reviewFrcCode({path:"src/main/java/frc/robot/subsystems/DriveSubsystem.java",content:sample});

export default function CodePage() {
  return <main className="module-page"><header className="app-page-header"><div><span className="breadcrumbs">Build / Code</span><h1>FRC Code Builder / Debugger</h1><p>Robot-specific risk review and human-approved proposal artifacts. Vantage does not deploy code to a robot.</p></div><span className="app-badge demo">Deterministic demo</span></header>
    <section className="code-workbench"><article className="app-card code-source"><header><div><span className="app-badge">Repository input</span><h2>DriveSubsystem.java</h2></div><span className="app-badge demo">Demo</span></header><pre>{sample}</pre><footer><span>Read-only example input</span><b>4 lines</b></footer></article>
      <article className="app-card code-findings"><header><div><span className={`app-badge ${review.riskLevel==="high"?"danger":""}`}>{review.riskLevel} risk</span><h2>Review findings</h2></div><strong>{review.risks.length}</strong></header><ul>{review.risks.map(risk=><li key={risk.pattern}><div><span className={`severity ${risk.severity}`}>{risk.severity}</span><b>{risk.pattern.replaceAll("-"," ")}</b></div><p>{risk.message}</p><code>{risk.evidence}</code></li>)}</ul></article>
      <article className="app-card code-checks"><header><h2>Required checks</h2><span className="app-badge good">Policy</span></header><ol>{review.requiredChecks.map((check,index)=><li key={check}><b>{index+1}</b><span>{check}</span></li>)}</ol><div className="proposal-state"><span>OUTPUT STATE</span><strong>Proposal only · human approval required</strong></div></article>
    </section>
  </main>;
}
