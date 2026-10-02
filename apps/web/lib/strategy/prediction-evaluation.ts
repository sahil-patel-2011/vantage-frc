export type MeasuredPrediction = { modelVersion: string; probability: number; winner: string; predictedAt: string; startedAt: string };
/** Grades predictions made before the match began, never hindsight recomputations. */
export function evaluateRecordedPredictions(rows: MeasuredPrediction[]) {
  const groups = new Map<string, MeasuredPrediction[]>();
  for (const row of rows) {
    if (!["red", "blue"].includes(row.winner) || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1 ||
      !Number.isFinite(Date.parse(row.predictedAt)) || !Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.predictedAt) >= Date.parse(row.startedAt)) continue;
    const group = groups.get(row.modelVersion) ?? []; group.push(row); groups.set(row.modelVersion, group);
  }
  return [...groups].map(([modelVersion, sample]) => {
    let correct=0, loss=0, brier=0;
    for (const row of sample) {
      const truth = row.winner === "red" ? 1 : 0;
      const p = Math.max(1e-9, Math.min(1-1e-9, row.probability));
      if ((row.probability > .5 && truth === 1) || (row.probability < .5 && truth === 0)) correct++;
      loss -= truth*Math.log(p)+(1-truth)*Math.log(1-p);
      brier += (row.probability-truth)**2;
    }
    return { modelVersion, matches: sample.length, accuracy: correct/sample.length, logLoss: loss/sample.length, brier: brier/sample.length };
  }).sort((a,b) => b.matches-a.matches);
}
