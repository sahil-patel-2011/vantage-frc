import { describe, expect, it } from "vitest";
import { checkFeatures, checkNumbers, checkPaste, parseGitHubUrl } from "./checks";
import { GUIDED_TRACKS, guidedStep } from "./tracks";
import { guidedLessonId } from "./types";

describe("guided track content", () => {
  it("gives every step an id, instructions, a check and a sentence saying how it is checked", () => {
    for (const track of GUIDED_TRACKS) {
      const ids = track.steps.map((step) => step.id);
      expect(new Set(ids).size, `${track.id} step ids are unique`).toBe(ids.length);
      for (const step of track.steps) {
        expect(step.do.length, `${track.id}/${step.id} has steps to do`).toBeGreaterThan(0);
        expect(step.checkedBy.trim().length, `${track.id}/${step.id} says how it is checked`).toBeGreaterThan(10);
        expect(step.check.kind).toBeTruthy();
      }
    }
  });

  it("checks the Onshape track in Onshape and 6925 programming with real checks, not only sign-offs", () => {
    const onshape = GUIDED_TRACKS.find((track) => track.id === "onshape-first-part")!;
    expect(onshape.steps.every((step) => step.check.kind.startsWith("onshape"))).toBe(true);
    const programming = GUIDED_TRACKS.find((track) => track.id === "frc6925-programming")!;
    expect(programming.steps).toHaveLength(10);
    const automatic = programming.steps.filter((step) => step.check.kind !== "lead-signoff");
    expect(automatic.length).toBeGreaterThanOrEqual(8);
  });

  it("stores progress apart from the CAD track's lesson ids", () => {
    expect(guidedLessonId("frc6925-programming", "prog-1")).toBe("guided:frc6925-programming:prog-1");
    expect(guidedStep("frc6925-programming", "prog-1")?.check.kind).toBe("paste");
    expect(guidedStep("nope", "prog-1")).toBeNull();
  });
});

describe("checkFeatures", () => {
  const expect2 = [
    { featureType: "newSketch", label: "a sketch" },
    { featureType: "extrude", label: "an extrude" },
  ];
  it("passes when every expected feature is there, ignoring suppressed ones", () => {
    const result = checkFeatures(
      [
        { featureType: "newSketch" },
        { featureType: "extrude" },
        { featureType: "fillet", suppressed: true },
      ],
      expect2,
    );
    expect(result.passed).toBe(true);
    expect(result.evidence?.[0]).toMatch(/2 features.*1 suppressed/);
  });
  it("names what is missing", () => {
    const result = checkFeatures([{ featureType: "newSketch" }, { featureType: "extrude", suppressed: true }], expect2);
    expect(result.passed).toBe(false);
    expect(result.message).toBe("Not yet: this Part Studio still needs an extrude.");
  });
  it("accepts any one of several ways with anyOf", () => {
    const ways = [
      { featureType: "hole", label: "a Hole" },
      { featureType: "extrude", min: 2, label: "a second extrude (a cut)" },
    ];
    expect(checkFeatures([{ featureType: "extrude" }, { featureType: "extrude" }], ways, true).passed).toBe(true);
    const none = checkFeatures([{ featureType: "extrude" }], ways, true);
    expect(none.passed).toBe(false);
    expect(none.message).toMatch(/a Hole or 2 × a second extrude/);
  });
});

describe("checkPaste", () => {
  const check = guidedStep("frc6925-programming", "prog-1")!.check;
  if (check.kind !== "paste") throw new Error("prog-1 is a paste check");
  it("passes a real deploy and console log", () => {
    expect(checkPaste(check, "> Task :deploy\nBUILD SUCCESSFUL in 14s\n...\n********** Robot program starting **********").passed).toBe(true);
  });
  it("names the first thing missing", () => {
    const result = checkPaste(check, "BUILD FAILED in 3s");
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/BUILD SUCCESSFUL/);
    expect(checkPaste(check, "").message).toBe("Paste the text first.");
  });
});

describe("checkNumbers", () => {
  const check = guidedStep("frc6925-programming", "prog-6")!.check;
  if (check.kind !== "numbers") throw new Error("prog-6 is a numbers check");
  it("passes within 10 cm and fails outside it", () => {
    expect(checkNumbers(check, { measured: "3.00", reported: "2.93" }).passed).toBe(true);
    const off = checkNumbers(check, { measured: 3, reported: 2.8 });
    expect(off.passed).toBe(false);
    expect(off.message).toMatch(/0.2 m apart/);
    expect(checkNumbers(check, { measured: "3" }).message).toMatch(/odometry distance/);
  });
});

describe("parseGitHubUrl", () => {
  it("reads pull requests and tags and refuses anything else", () => {
    expect(parseGitHubUrl("https://github.com/frc6925/robot-2026/pull/42")).toEqual({ kind: "pr", owner: "frc6925", repo: "robot-2026", number: 42 });
    expect(parseGitHubUrl("https://github.com/frc6925/robot-2026/releases/tag/week0")).toEqual({ kind: "tag", owner: "frc6925", repo: "robot-2026", tag: "week0" });
    expect(parseGitHubUrl("https://gitlab.com/a/b/pull/1")).toBeNull();
    expect(parseGitHubUrl("not a url")).toBeNull();
    expect(parseGitHubUrl("https://github.com/a/b")).toBeNull();
  });
});
