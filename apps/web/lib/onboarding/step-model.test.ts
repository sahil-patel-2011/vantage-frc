import { describe, expect, it } from "vitest";
import {
  buildOnboardingPendingPlan,
  defaultFocusForRole,
  emptyOnboardingDraft,
  nextOnboardingStep,
  onboardingAdvance,
  onboardingGoBack,
  previousOnboardingStep,
  submittedTeamNumber,
  validateOnboardingStep,
  type OnboardingDraft,
  type OnboardingStepContext,
} from "./step-model";

/** A draft that clears screen 1 — the two server-required account fields included. */
function filledProfile(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    ...emptyOnboardingDraft(),
    firstName: "Avery",
    lastName: "Nguyen",
    dateOfBirth: "2009-04-11",
    gender: "prefer_not_to_say",
    teamRole: "student",
    crewRole: "scout",
    ...overrides,
  };
}

const BASE_CONTEXT: OnboardingStepContext = {
  isTeamHead: false,
  legalNeeded: true,
  locked: false,
  lockedTeamNumber: null,
  lockedOrgName: null,
  accessStatus: null,
  knownTeamNumber: null,
};

describe("onboarding step gates", () => {
  it("blocks screen 1 until name and the server-required date of birth exist", () => {
    const empty = emptyOnboardingDraft();
    expect(validateOnboardingStep("profile", empty, BASE_CONTEXT)).toMatchObject({
      ok: false,
      field: "firstName",
    });
    expect(
      validateOnboardingStep("profile", { ...empty, firstName: "Avery" }, BASE_CONTEXT),
    ).toMatchObject({ ok: false, field: "lastName" });

    // DOB is required by `POST /api/onboarding` (regex, not optional), so the
    // gate must not let it through — and must say why it is being asked.
    const noDob = filledProfile({ dateOfBirth: "" });
    const result = validateOnboardingStep("profile", noDob, BASE_CONTEXT);
    expect(result).toMatchObject({ ok: false, field: "dateOfBirth" });
    expect(result.ok === false && result.message).toMatch(/youth-safe/i);

    expect(validateOnboardingStep("profile", filledProfile(), BASE_CONTEXT)).toEqual({ ok: true });
  });

  it("rejects a malformed date of birth rather than passing it to the server", () => {
    expect(
      validateOnboardingStep("profile", filledProfile({ dateOfBirth: "04/11/2009" }), BASE_CONTEXT),
    ).toMatchObject({ ok: false, field: "dateOfBirth" });
  });

  it("lets screen 2 through with no team number, but not with a bad one", () => {
    const noTeam = filledProfile({ noTeam: true });
    expect(validateOnboardingStep("team", noTeam, BASE_CONTEXT)).toEqual({ ok: true });

    const blank = filledProfile({ teamNumber: "" });
    expect(validateOnboardingStep("team", blank, BASE_CONTEXT)).toMatchObject({
      ok: false,
      field: "teamNumber",
    });

    const bad = filledProfile({ teamNumber: "0" });
    expect(validateOnboardingStep("team", bad, BASE_CONTEXT)).toMatchObject({
      ok: false,
      field: "teamNumber",
    });

    expect(validateOnboardingStep("team", filledProfile({ teamNumber: "1234" }), BASE_CONTEXT)).toEqual({
      ok: true,
    });
  });

  it("asks team heads for affiliation and a funding path on screen 2", () => {
    const head = { ...BASE_CONTEXT, isTeamHead: true };
    const draft = filledProfile({ teamNumber: "1234" });
    expect(validateOnboardingStep("team", draft, head)).toMatchObject({
      ok: false,
      field: "teamAffiliation",
    });
    expect(
      validateOnboardingStep(
        "team",
        { ...draft, teamAffiliation: "public_school", sponsorsAllowed: false },
        head,
      ),
    ).toMatchObject({ ok: false, field: "funding" });
    expect(
      validateOnboardingStep(
        "team",
        { ...draft, teamAffiliation: "public_school", fundingModel: "sponsored" },
        head,
      ),
    ).toEqual({ ok: true });
  });

  it("keeps BOTH consent boxes required on the finish screen", () => {
    const draft = filledProfile({ teamNumber: "1234" });
    expect(validateOnboardingStep("preferences", draft, BASE_CONTEXT)).toMatchObject({
      ok: false,
      field: "legal",
    });
    expect(
      validateOnboardingStep("preferences", { ...draft, termsAccepted: true }, BASE_CONTEXT),
    ).toMatchObject({ ok: false, field: "legal" });
    expect(
      validateOnboardingStep("preferences", { ...draft, privacyAccepted: true }, BASE_CONTEXT),
    ).toMatchObject({ ok: false, field: "legal" });
    expect(
      validateOnboardingStep(
        "preferences",
        { ...draft, termsAccepted: true, privacyAccepted: true },
        BASE_CONTEXT,
      ),
    ).toEqual({ ok: true });
  });

  it("skips the consent gate only when the server already has both timestamps", () => {
    const draft = filledProfile({ teamNumber: "1234" });
    expect(
      validateOnboardingStep("preferences", draft, { ...BASE_CONTEXT, legalNeeded: false }),
    ).toEqual({ ok: true });
  });
});

describe("onboarding forward / back navigation", () => {
  const ready = filledProfile({ teamNumber: "1234", termsAccepted: true, privacyAccepted: true });

  it("advances one screen at a time and submits on the last", () => {
    expect(nextOnboardingStep("profile")).toBe("team");
    expect(nextOnboardingStep("team")).toBe("preferences");
    expect(nextOnboardingStep("preferences")).toBeNull();

    const one = onboardingAdvance(
      { step: "profile", draft: ready, error: null, errorField: null },
      BASE_CONTEXT,
    );
    expect(one).toMatchObject({ step: "team", submit: false, error: null });

    const two = onboardingAdvance(
      { step: "team", draft: ready, error: null, errorField: null },
      BASE_CONTEXT,
    );
    expect(two).toMatchObject({ step: "preferences", submit: false });

    const three = onboardingAdvance(
      { step: "preferences", draft: ready, error: null, errorField: null },
      BASE_CONTEXT,
    );
    expect(three).toMatchObject({ step: "preferences", submit: true });
  });

  it("a failed gate keeps the step AND every answer already typed", () => {
    const draft = filledProfile({ dateOfBirth: "", roleDescription: "Stand scout, red 2" });
    const blocked = onboardingAdvance(
      { step: "profile", draft, error: null, errorField: null },
      BASE_CONTEXT,
    );
    expect(blocked.step).toBe("profile");
    expect(blocked.submit).toBe(false);
    expect(blocked.errorField).toBe("dateOfBirth");
    // Nothing typed is discarded by a failed validation.
    expect(blocked.draft).toEqual(draft);
  });

  it("back never validates and never rewrites the draft", () => {
    const draft = filledProfile({ teamNumber: "1", roleDescription: "half typed" });
    const back = onboardingGoBack({
      step: "preferences",
      draft,
      error: "some earlier error",
      errorField: "legal",
    });
    expect(back.step).toBe("team");
    expect(back.draft).toEqual(draft);
    expect(back.error).toBeNull();
    expect(back.errorField).toBeNull();

    // Round-tripping forward then back leaves the draft byte-identical.
    const forward = onboardingAdvance(
      { step: back.step, draft: back.draft, error: null, errorField: null },
      BASE_CONTEXT,
    );
    expect(onboardingGoBack(forward).draft).toEqual(draft);
  });

  it("cannot go back past the first screen, and stops at the ends", () => {
    expect(previousOnboardingStep("profile")).toBeNull();
    expect(previousOnboardingStep("team")).toBe("profile");
    expect(previousOnboardingStep("preferences")).toBe("team");
    // The pending panel's "change my answers" returns to the team screen.
    expect(previousOnboardingStep("pending")).toBe("team");
    expect(previousOnboardingStep("done")).toBeNull();

    const draft = filledProfile();
    expect(onboardingGoBack({ step: "profile", draft, error: null, errorField: null })).toMatchObject({
      step: "profile",
      draft,
    });
  });

  it("never advances out of a terminal state", () => {
    const draft = filledProfile();
    for (const step of ["pending", "done"] as const) {
      const result = onboardingAdvance({ step, draft, error: null, errorField: null }, BASE_CONTEXT);
      expect(result).toMatchObject({ step, submit: false });
    }
  });
});

describe("submitted team number", () => {
  it("honours the lock, the opt-out, and rejects unparseable text", () => {
    const draft = filledProfile({ teamNumber: "1234" });
    expect(submittedTeamNumber(draft, { locked: false, lockedTeamNumber: null, isTeamHead: false })).toBe(
      1234,
    );
    expect(
      submittedTeamNumber(draft, { locked: true, lockedTeamNumber: 254, isTeamHead: false }),
    ).toBe(254);
    expect(
      submittedTeamNumber({ ...draft, noTeam: true }, { locked: false, lockedTeamNumber: null, isTeamHead: false }),
    ).toBeNull();
    expect(
      submittedTeamNumber({ ...draft, teamNumber: "" }, { locked: false, lockedTeamNumber: null, isTeamHead: false }),
    ).toBeNull();
  });
});

describe("default focus for a role + crew", () => {
  it("prefers the crew, falls back to the role", () => {
    expect(defaultFocusForRole("student", "scout")).toBe("competition");
    expect(defaultFocusForRole("student", "driver")).toBe("competition");
    expect(defaultFocusForRole("student", "programming")).toBe("build");
    expect(defaultFocusForRole("student", "cad")).toBe("build");
    expect(defaultFocusForRole("student", "business")).toBe("business");
    // Crew wins even when the role would suggest something else.
    expect(defaultFocusForRole("coach", "programming")).toBe("build");
    expect(defaultFocusForRole("coach", "")).toBe("leadership");
    expect(defaultFocusForRole("mentor", "")).toBe("leadership");
    expect(defaultFocusForRole("student", "")).toBe("competition");
  });
});

describe("pending-approval plan", () => {
  it("names who was notified when a request is genuinely with a team", () => {
    const plan = buildOnboardingPendingPlan({
      accessStatus: "pending",
      teamNumber: 1234,
      orgName: "Robo Rangers",
      adult: false,
    });
    expect(plan.kind).toBe("pending");
    expect(plan.headline).toContain("Robo Rangers");
    expect(plan.notified).toMatch(/owner and admin/i);
    expect(plan.stages.map((s) => s.phase)).toEqual(["done", "current", "upcoming"]);
    expect(plan.primaryAction.kind).toBe("check");
    expect(plan.meanwhile.length).toBeGreaterThan(0);
    // Every "meanwhile" link is a real in-app route, not a placeholder.
    expect(plan.meanwhile.every((link) => link.href.startsWith("/"))).toBe(true);
  });

  it("claims nobody was notified when nobody was", () => {
    for (const status of ["invited", "declined"] as const) {
      const plan = buildOnboardingPendingPlan({
        accessStatus: status,
        teamNumber: 1234,
        orgName: null,
        adult: true,
      });
      expect(plan.notified).toBe("");
    }
  });

  it("routes a server-confirmed empty team number to claim only for adults", () => {
    const adult = buildOnboardingPendingPlan({
      accessStatus: "none",
      teamNumber: 9999,
      orgName: null,
      adult: true,
    });
    expect(adult.kind).toBe("no_workspace");
    expect(adult.primaryAction).toEqual({ kind: "claim", label: "Claim this team" });

    const student = buildOnboardingPendingPlan({
      accessStatus: "none",
      teamNumber: 9999,
      orgName: null,
      adult: false,
    });
    expect(student.kind).toBe("no_workspace");
    expect(student.primaryAction.kind).toBe("edit");
    expect(student.stages[1]?.title).toMatch(/mentor or coach/i);
  });

  it("has a distinct state for finishing without any team number", () => {
    const plan = buildOnboardingPendingPlan({
      accessStatus: "none",
      teamNumber: null,
      orgName: null,
      adult: false,
    });
    expect(plan.kind).toBe("no_team");
    expect(plan.notified).toBe("");
    expect(plan.primaryAction.kind).toBe("edit");
  });

  it("points an invited person at the invitation instead of a second request", () => {
    const plan = buildOnboardingPendingPlan({
      accessStatus: "invited",
      teamNumber: 1234,
      orgName: "Robo Rangers",
      adult: false,
    });
    expect(plan.kind).toBe("invited");
    expect(plan.primaryAction.kind).toBe("invite");
  });
});
