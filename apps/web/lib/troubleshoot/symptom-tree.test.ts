import { describe, expect, it } from "vitest";
import {
  ALLOWED_DOC_HOSTS,
  SYMPTOMS,
  checkById,
  describeStoredPath,
  fixById,
  listSymptoms,
  matchSymptoms,
  storedPath,
  symptomById,
  symptomDocs,
  walkSymptom,
  type TroubleshootSymptom,
} from "./symptom-tree";

function reachableCheckIds(symptom: TroubleshootSymptom): Set<string> {
  const seen = new Set<string>();
  const queue = [symptom.entryCheckId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const check = checkById(symptom, id);
    if (!check) continue;
    for (const outcome of check.outcomes) {
      if (outcome.next.kind === "check") queue.push(outcome.next.checkId);
    }
  }
  return seen;
}

function reachableFixIds(symptom: TroubleshootSymptom): Set<string> {
  const fixes = new Set<string>();
  for (const id of reachableCheckIds(symptom)) {
    const check = checkById(symptom, id);
    if (!check) continue;
    for (const outcome of check.outcomes) {
      if (outcome.next.kind === "fix") fixes.add(outcome.next.fixId);
    }
  }
  return fixes;
}

describe("symptom tree shape", () => {
  it("covers the recurring control-system blockers the research named", () => {
    expect(SYMPTOMS.map((symptom) => symptom.id).sort()).toEqual([
      "brownout",
      "can-device-not-found",
      "deploy-fails",
      "ds-no-code",
      "ds-no-comms",
      "motor-controller-blink-code",
      "radio-not-configured",
      "roborio-imaging",
    ]);
  });

  it("gives every symptom a unique id and a listable summary", () => {
    const ids = SYMPTOMS.map((symptom) => symptom.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of listSymptoms()) {
      expect(row.label.length).toBeGreaterThan(3);
      expect(row.summary.length).toBeGreaterThan(20);
      expect(row.checkCount).toBeGreaterThanOrEqual(2);
      expect(row.fixCount).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps check and fix ids unique inside each symptom", () => {
    for (const symptom of SYMPTOMS) {
      const checkIds = symptom.checks.map((check) => check.id);
      expect(new Set(checkIds).size, `duplicate check id in ${symptom.id}`).toBe(checkIds.length);
      const fixIds = symptom.fixes.map((fix) => fix.id);
      expect(new Set(fixIds).size, `duplicate fix id in ${symptom.id}`).toBe(fixIds.length);
    }
  });

  it("starts every symptom at a real check with at least two outcomes each", () => {
    for (const symptom of SYMPTOMS) {
      expect(checkById(symptom, symptom.entryCheckId), `${symptom.id} entry`).not.toBeNull();
      for (const check of symptom.checks) {
        expect(check.outcomes.length, `${symptom.id}:${check.id}`).toBeGreaterThanOrEqual(2);
        const outcomeIds = check.outcomes.map((outcome) => outcome.id);
        expect(new Set(outcomeIds).size).toBe(outcomeIds.length);
        expect(check.action.length).toBeGreaterThan(20);
        expect(check.why.length, `${symptom.id}:${check.id} needs a why`).toBeGreaterThan(30);
      }
    }
  });

  it("points every outcome at something that exists", () => {
    for (const symptom of SYMPTOMS) {
      for (const check of symptom.checks) {
        for (const outcome of check.outcomes) {
          const where = `${symptom.id}:${check.id}:${outcome.id}`;
          expect(outcome.rulesOut.length, `${where} must say what it rules out`).toBeGreaterThan(20);
          if (outcome.next.kind === "check") {
            expect(checkById(symptom, outcome.next.checkId), where).not.toBeNull();
          } else if (outcome.next.kind === "fix") {
            expect(fixById(symptom, outcome.next.fixId), where).not.toBeNull();
          } else {
            expect(symptomById(outcome.next.symptomId), where).not.toBeNull();
            expect(outcome.next.symptomId).not.toBe(symptom.id);
          }
        }
      }
    }
  });

  it("leaves no unreachable check or fix", () => {
    for (const symptom of SYMPTOMS) {
      const checks = reachableCheckIds(symptom);
      for (const check of symptom.checks) {
        expect(checks.has(check.id), `${symptom.id}:${check.id} unreachable`).toBe(true);
      }
      const fixes = reachableFixIds(symptom);
      for (const fix of symptom.fixes) {
        expect(fixes.has(fix.id), `${symptom.id}:${fix.id} unreachable`).toBe(true);
      }
    }
  });

  it("orders checks cheapest-first — cost strictly increases down every path", () => {
    for (const symptom of SYMPTOMS) {
      for (const check of symptom.checks) {
        expect(check.minutes).toBeGreaterThanOrEqual(1);
        for (const outcome of check.outcomes) {
          if (outcome.next.kind !== "check") continue;
          const next = checkById(symptom, outcome.next.checkId)!;
          expect(
            next.minutes,
            `${symptom.id}: ${check.id}(${check.minutes}m) -> ${next.id}(${next.minutes}m)`,
          ).toBeGreaterThan(check.minutes);
        }
      }
    }
  });

  it("cites a real documentation URL on every fix", () => {
    for (const symptom of SYMPTOMS) {
      for (const fix of symptom.fixes) {
        const where = `${symptom.id}:${fix.id}`;
        expect(fix.steps.length, where).toBeGreaterThanOrEqual(3);
        expect(fix.principle.length, `${where} must teach the principle`).toBeGreaterThan(40);
        for (const doc of [fix.doc, ...(fix.moreDocs ?? [])]) {
          const url = new URL(doc.url);
          expect(url.protocol, `${where} -> ${doc.url}`).toBe("https:");
          expect(ALLOWED_DOC_HOSTS as readonly string[], `${where} -> ${doc.url}`).toContain(url.hostname);
          expect(doc.label.length).toBeGreaterThan(5);
        }
      }
    }
  });

  it("collects the docs for a symptom without duplicates", () => {
    const docs = symptomDocs(symptomById("roborio-imaging")!);
    expect(docs.length).toBeGreaterThan(2);
    expect(new Set(docs.map((doc) => doc.url)).size).toBe(docs.length);
  });
});

describe("matchSymptoms — useful with no AI at all", () => {
  const cases: Array<[string, string]> = [
    ["we cannot reimage any of our roboRIOs", "roborio-imaging"],
    ["code won't deploy", "deploy-fails"],
    ["gradle says could not find any available roborio", "deploy-fails"],
    ["driver station has no comms", "ds-no-comms"],
    ["no communication with the robot", "ds-no-comms"],
    ["robot code light is red", "ds-no-code"],
    ["we need to program the radio", "radio-not-configured"],
    ["the robot browns out when we drive and shoot", "brownout"],
    ["can device not found", "can-device-not-found"],
    ["motor controller is blinking orange", "motor-controller-blink-code"],
  ];

  for (const [text, expected] of cases) {
    it(`routes "${text}" to ${expected}`, () => {
      const hits = matchSymptoms(text);
      expect(hits[0]?.symptomId, JSON.stringify(hits)).toBe(expected);
    });
  }

  it("returns nothing for text with no signal", () => {
    expect(matchSymptoms("")).toEqual([]);
    expect(matchSymptoms("zzzz qqqq")).toEqual([]);
  });

  it("is deterministic and ranked", () => {
    const first = matchSymptoms("no comms on the driver station", 3);
    const second = matchSymptoms("no comms on the driver station", 3);
    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < first.length; i += 1) {
      expect(first[i - 1]!.score).toBeGreaterThanOrEqual(first[i]!.score);
    }
  });
});

describe("walkSymptom", () => {
  it("returns the entry check for an empty walk", () => {
    const walk = walkSymptom("roborio-imaging", [])!;
    expect(walk.current?.id).toBe("model");
    expect(walk.history).toEqual([]);
    expect(walk.fix).toBeNull();
    expect(walk.minutesSpent).toBe(0);
  });

  it("reaches a fix and keeps the visible reasoning", () => {
    const walk = walkSymptom("roborio-imaging", [{ checkId: "model", outcomeId: "rio2" }])!;
    expect(walk.fix?.id).toBe("rio2-sdcard");
    expect(walk.current).toBeNull();
    expect(walk.history).toHaveLength(1);
    expect(walk.history[0]!.rulesOut).toContain("USB imaging path");
    expect(walk.minutesSpent).toBe(1);
  });

  it("walks several checks deep", () => {
    const walk = walkSymptom("deploy-fails", [
      { checkId: "build-only", outcomeId: "build-ok" },
      { checkId: "ds-comms", outcomeId: "green" },
      { checkId: "team-number", outcomeId: "match" },
    ])!;
    expect(walk.current?.id).toBe("deploy-error");
    expect(walk.history.map((step) => step.checkId)).toEqual(["build-only", "ds-comms", "team-number"]);
    expect(walk.minutesSpent).toBe(2 + 3 + 4);
  });

  it("hands off to another symptom rather than inventing a fix", () => {
    const walk = walkSymptom("deploy-fails", [
      { checkId: "build-only", outcomeId: "build-ok" },
      { checkId: "ds-comms", outcomeId: "red" },
    ])!;
    expect(walk.handoffSymptomId).toBe("ds-no-comms");
    expect(walk.fix).toBeNull();
    expect(walk.current).toBeNull();
  });

  it("flags an out-of-order or unknown answer instead of guessing", () => {
    expect(walkSymptom("roborio-imaging", [{ checkId: "safe-mode", outcomeId: "safe-works" }])!.invalid).toBe(true);
    expect(walkSymptom("roborio-imaging", [{ checkId: "model", outcomeId: "nope" }])!.invalid).toBe(true);
    expect(walkSymptom("not-a-symptom", [])).toBeNull();
  });

  it("stores a compact, self-describing path", () => {
    const walk = walkSymptom("brownout", [
      { checkId: "confirm-brownout", outcomeId: "dip" },
      { checkId: "battery-state", outcomeId: "suspect" },
    ])!;
    const path = storedPath(walk);
    expect(path.symptomId).toBe("brownout");
    expect(path.fixId).toBe("battery-swap");
    expect(path.steps.map((step) => step.outcomeId)).toEqual(["dip", "suspect"]);
    expect(path.docUrls.every((url) => url.startsWith("https://"))).toBe(true);
    expect(path.minutesSpent).toBe(5);
    expect(describeStoredPath(path)).toContain("Robot browns out");
  });

  it("describes an unfinished path honestly", () => {
    const walk = walkSymptom("brownout", [{ checkId: "confirm-brownout", outcomeId: "dip" }])!;
    const path = storedPath(walk);
    expect(path.fixId).toBeNull();
    expect(describeStoredPath(path)).toContain("no fix recorded");
  });
});
