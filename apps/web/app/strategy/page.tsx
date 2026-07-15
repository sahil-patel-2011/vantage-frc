import { buildStrategyPlaybook, predictMatch, runWhatIf } from "@vantage/prediction-strategy";

const prediction = predictMatch({
  matchKey: "demo_qm42", currentYear: 2026,
  red: ["frc254","frc1678","frc4414"], blue: ["frc2056","frc1323","frc971"],
  seasons: [
    ...["frc254","frc1678","frc4414"].map((teamKey,index)=>({teamKey,year:2026,matches:12,epa:[31,28,24][index]!,autoEpa:[8,7,6][index]})),
    ...["frc2056","frc1323","frc971"].map((teamKey,index)=>({teamKey,year:2026,matches:12,epa:[29,25,23][index]!,autoEpa:[7,6,5][index]})),
  ],
  operations: [{teamKey:"frc254",scoutSample:10,reliability:94},{teamKey:"frc971",scoutSample:8,reliability:83,foulRate:1.2}],
});
const scenario = runWhatIf(prediction,[{alliance:"red",label:"Protect autonomous route",pointDelta:4},{alliance:"blue",label:"One practiced defender",pointDelta:-3}]);
const playbook = buildStrategyPlaybook({prediction,ourAlliance:"red",opponentFoulRisk:"medium"});

export default function StrategyPage() {
  return <main className="module-page"><header className="app-page-header"><div><span className="breadcrumbs">Competition / Strategy</span><h1>Win / Loss + Strategy</h1><p>Probability, factors, explicit assumptions, and a reviewable match playbook.</p></div><span className="app-badge demo">Deterministic demo</span></header>
    <section className="strategy-workbench"><article className="app-card strategy-primary"><header><div><span className="app-badge good">Available</span><h2>Qualification 42</h2></div><small>{prediction.modelVersion}</small></header><div className="strategy-probability"><strong>{Math.round(prediction.pRed*100)}%</strong><span>Red alliance</span><small>{Math.round(prediction.confidenceLow*100)}–{Math.round(prediction.confidenceHigh*100)}% confidence · effective sample {prediction.effectiveSampleSize}</small></div><div className="mini-probability"><i style={{width:`${prediction.pRed*100}%`}}/></div><h3>Key factors</h3><ul className="factor-table">{prediction.keyFactors.map(factor=><li key={factor.name}><b>{factor.impact}</b><span>{factor.name}</span><small>{factor.evidence}</small></li>)}</ul>{prediction.caveats.map(item=><p className="app-muted" key={item}>{item}</p>)}</article>
      <article className="app-card what-if-card"><header><h2>What-if scenario</h2><span className="app-badge demo">Demo</span></header><div><strong>{Math.round(scenario.pRed*100)}%</strong><span>{scenario.delta>=0?"+":""}{Math.round(scenario.delta*100)} pts</span></div><ul>{scenario.assumptions.map(item=><li key={item.label}><span>{item.label}</span><b>{item.pointDelta>0?"+":""}{item.pointDelta} points</b></li>)}</ul><p className="app-muted">Scenario changes are stored as assumptions, not observations.</p></article>
      <article className="app-card playbook-card"><header><h2>Alliance playbook</h2><span className="app-badge demo">Demo</span></header><ol>{playbook.priorities.map((item,index)=><li key={item}><b>{index+1}</b><span>{item}</span></li>)}</ol><h3>Role checkpoints</h3><div className="checkpoint-row">{playbook.checkpoints.map(item=><span key={item}>{item}</span>)}</div></article>
    </section>
  </main>;
}
