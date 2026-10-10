import { describe, expect, it } from "vitest";
import { buildEventTrend, eventTrendMetrics } from "./event-trends";
import type { ObservedRobot } from "./team-profiles";
const field = { key: "tower_level", label: "Endgame tower climb", type: "select" as const, options: ["none", "L1", "L2", "L3", "park", "could_not_see"] };
const report = (qm: number, value: unknown, confidence: "normal" | "low" = "normal") => ({ eventKey: "2026test", matchKey: `2026test_qm${qm}`, confidence, payload: value === undefined ? {} : { tower_level: value }, fields: [field] });
describe("observed event trends", () => {
  it("deduplicates robot matches and never calls missing or conflicting answers a no-climb", () => {
    const robots: ObservedRobot[] = [{ teamKey:"frc1", reports:[report(1,"none"),report(1,"none"),report(2,"none")] },{ teamKey:"frc2", reports:[report(1,"L3"),report(2,"L3"),report(2,"none")] },{ teamKey:"frc3",reports:[report(1,undefined),report(2,"could_not_see")] }];
    const metric=eventTrendMetrics(robots,"2026test",false)[0]!; const trend=buildEventTrend(robots,"2026test",metric,false);
    expect(trend).toMatchObject({ total:6, answered:3, missing:3, knownTeams:2, watchedTeams:3, disagreements:1, neverClimbed:["frc1"], reports:8 });
    expect(trend.outcomes).toEqual([["none",2],["L3",1]]);
  });
  it("filters actual event/confidence records and handles park as no climb", () => {
    const robots: ObservedRobot[]=[{teamKey:"frc1",reports:[report(1,"park"),report(2,"L3","low"),{...report(3,"L3"),eventKey:"2026other"}]}];
    const metric=eventTrendMetrics(robots,"2026test",false)[0]!;
    expect(buildEventTrend(robots,"2026test",metric,false).neverClimbed).toEqual(["frc1"]);
    expect(buildEventTrend(robots,"2026test",metric,true).neverClimbed).toEqual([]);
  });
  it("compares qualifications in numeric match order and excludes playoffs from periods", () => {
    const robots: ObservedRobot[]=[{teamKey:"frc1",reports:[report(10,"L3"),report(2,"none"),report(1,"none"),report(11,"L2"),{...report(99,"none"),matchKey:"2026test_sf1m1"}]}];
    const trend=buildEventTrend(robots,"2026test",eventTrendMetrics(robots,"2026test",false)[0]!,false);
    expect(trend.recent).toEqual({early:{answered:2,value:0},late:{answered:2,value:1},earlyLabel:"Q1–Q2",lateLabel:"Q10–Q11"});
  });
  it("averages duplicate numeric observations within a robot-match, retaining observed zero", () => {
    const fuel={key:"fuel",label:"Fuel scored",type:"number" as const,config:{unit:"fuel"}};
    const robots: ObservedRobot[]=[{teamKey:"frc1",reports:[{...report(1,undefined),fields:[fuel],payload:{fuel:0}},{...report(1,undefined),fields:[fuel],payload:{fuel:2}},{...report(2,undefined),fields:[fuel],payload:{fuel:5}},{...report(3,undefined),fields:[fuel],payload:{}}]}];
    expect(buildEventTrend(robots,"2026test",eventTrendMetrics(robots,"2026test",false)[0]!,false)).toMatchObject({mean:3,answered:2,missing:1});
  });
  it("refuses incompatible custom form units rather than pooling unrelated values", () => {
    const robots: ObservedRobot[]=[{teamKey:"frc1",reports:[{...report(1,undefined),fields:[{key:"speed",label:"Speed",type:"number",config:{unit:"m/s"}}],payload:{speed:3}},{...report(2,undefined),fields:[{key:"speed",label:"Speed",type:"number",config:{unit:"ft/s"}}],payload:{speed:10}}]}];
    const metric=eventTrendMetrics(robots,"2026test",false)[0]!;expect(metric.incompatible).toBe(true);
    expect(buildEventTrend(robots,"2026test",metric,false).answered).toBe(0);
  });

  it("separates explicit non-attempts, failures and unknown attempt status", () => {
    const expanded = { ...field, options: [...field.options, "not_attempted", "attempted_failed", "fell"] };
    const robots: ObservedRobot[] = [{ teamKey: "frc1", reports: ["not_attempted", "attempted_failed", "none", "L3", "could_not_see"].map((value, index) => ({ ...report(index + 1, value), fields: [expanded] })) }];
    const trend = buildEventTrend(robots, "2026test", eventTrendMetrics(robots, "2026test", false)[0]!, false);
    expect(trend.climbOutcomes).toEqual({ not_attempted: 1, failed: 1, no_success: 1, successful: 1, unseen: 1 });
    expect(trend.teamClimbs[0]).toMatchObject({ observed: 4, total: 5 });
    expect(trend.neverClimbed).toEqual([]);
  });

  it("preserves yes/no choice values when reducing multiple reports", () => {
    const choice = { key: "climb", label: "Climb result", type: "select" as const, options: ["yes", "no"] };
    const robots: ObservedRobot[] = [{ teamKey: "frc1", reports: ["yes", "yes", "no"].map(value => ({ ...report(1, undefined), fields: [choice], payload: { climb: value } })) }];
    const trend = buildEventTrend(robots, "2026test", eventTrendMetrics(robots, "2026test", false)[0]!, false);
    expect(trend.outcomes).toEqual([["yes", 1]]);
    expect(trend.climbOutcomes.successful).toBe(1);
  });

  it("keeps success known when reports disagree only on successful height", () => {
    const robots: ObservedRobot[] = [{ teamKey: "frc1", reports: [report(1, "L2"), report(1, "L3")] }];
    const trend = buildEventTrend(robots, "2026test", eventTrendMetrics(robots, "2026test", false)[0]!, false);
    expect(trend).toMatchObject({ total: 1, answered: 1, missing: 0, disagreements: 1 });
    expect(trend.climbOutcomes.successful).toBe(1);
    expect(trend.rows[0]!.payload.tower_level).toBeUndefined();
  });

  it("separates matches where the question was not on the form", () => {
    const robots: ObservedRobot[] = [{ teamKey: "frc1", reports: [report(1, "none"), { ...report(2, undefined), fields: [] }] }];
    const trend = buildEventTrend(robots, "2026test", eventTrendMetrics(robots, "2026test", false)[0]!, false);
    expect(trend).toMatchObject({ total: 2, answered: 1, missing: 1, unasked: 1 });
  });

  it.each([{ key: "can_climb", label: "Climb capable", type: "boolean" as const }, { key: "climb_attempted", label: "Climb attempted", type: "boolean" as const }])("does not interpret capability or attempt question %j as a successful outcome", capability => {
    const robots: ObservedRobot[] = [{ teamKey: "frc1", reports: [{ ...report(1, undefined), fields: [capability], payload: { [capability.key]: true } }] }];
    expect(buildEventTrend(robots, "2026test", eventTrendMetrics(robots, "2026test", false)[0]!, false).noClimb).toBe(false);
  });
  it("recognizes an explicit climb attempt result without inferring success from an attempt flag", () => {
    const outcome = { key: "climb_attempt_result", label: "Climb attempt outcome", type: "select" as const, options: ["attempted_failed", "not_attempted", "L3"] };
    const robots: ObservedRobot[] = [{ teamKey: "frc1", reports: [{ ...report(1, undefined), fields: [outcome], payload: { climb_attempt_result: "attempted_failed" } }] }];
    const trend = buildEventTrend(robots, "2026test", eventTrendMetrics(robots, "2026test", false)[0]!, false);
    expect(trend.noClimb).toBe(true);
    expect(trend.climbOutcomes.failed).toBe(1);
  });

  it("does not offer pit-only fields as match outcome metrics", () => {
    expect(eventTrendMetrics([{ teamKey: "frc1", reports: [{ ...report(1, "L3"), matchKey: null }] }], "2026test", false)).toEqual([]);
  });
});
