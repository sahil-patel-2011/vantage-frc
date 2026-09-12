import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategyView } from "../strategy/types";

vi.mock("../strategy/recompute", async () => {
  const actual = await vi.importActual<typeof import("../strategy/recompute")>("../strategy/recompute");
  return { ...actual, recomputeStrategyView: vi.fn() };
});

import { EMPTY_PREDICTION_COPY } from "../strategy/prediction-empty-copy";
import { recomputeStrategyView } from "../strategy/recompute";
import { briefingSectionsFromStrategyView, refreshBriefingPrediction } from "./refresh-prediction";

const recomputeMock = vi.mocked(recomputeStrategyView);

const ENGINE = {
  id: "weighted-current-v1" as const,
  label: "Weighted current",
  tier: "baseline" as const,
  planCode: "free",
  depth: 1,
  thisSeasonOnly: false,
};

function liveView(overrides: Partial<Extract<StrategyView, { status: "live" }>> = {}): Extract<
  StrategyView,
  { status: "live" }
> {
  return {
    status: "live",
    orgId: "org-1",
    eventKey: "2026mijac",
    eventName: "Jackson",
    teamNumber: 2337,
    tbaConfigured: true,
    matchKey: "2026mijac_qm1",
    compLevel: "qm",
    matchNumber: 1,
    ourAlliance: "red",
    red: ["frc2337", "frc27", "frc67"],
    blue: ["frc254", "frc118", "frc1678"],
    prediction: {
      matchKey: "2026mijac_qm1",
      modelVersion: "weighted-current-v1",
      pRed: 0.62,
      pBlue: 0.38,
      confidenceLow: 0.5,
      confidenceHigh: 0.74,
      effectiveSampleSize: 36,
      keyFactors: [
        { name: "EPA edge", alliance: "red", impact: 0.12, evidence: "statbotics", kind: "model" },
      ],
      caveats: ["Small sample"],
    },
    allianceBreakdown: {
      matchKey: "2026mijac_qm1",
      modelVersion: "weighted-current-v1",
      pRed: 0.62,
      pBlue: 0.38,
      confidenceLow: 0.5,
      confidenceHigh: 0.74,
      effectiveSampleSize: 36,
      red: [],
      blue: [],
      citations: [],
      keyFactors: [],
      caveats: [],
    },
    playbook: {
      title: "Protect the auto",
      winProbability: 0.62,
      priorities: ["Hold the barge"],
      strengthsToProtect: ["Auto"],
      risksToMitigate: [],
      checkpoints: [],
      debriefPrompts: [],
      provenance: [],
    },
    matchup: {
      red: [],
      blue: [],
      redTotalEpa: 90,
      blueTotalEpa: 70,
      considerations: [],
    },
    tendencies: [{ teamKey: "frc254", labels: ["cycle"], evidence: ["fast feeder"] }],
    pickListHints: [],
    scoutProvenance: [],
    operations: [
      {
        teamKey: "frc254",
        scoutSample: 4,
        autoCapability: 0.8,
        teleopCapability: 0.7,
        endgameCapability: 0.6,
        defenseLikely: false,
        foulRate: 0.1,
        pitNotes: ["swerve"],
      },
    ],
    engineeringContext: [],
    gameRules: {
      seasonYear: 2026,
      status: "empty",
      message: "No 2026 game rules yet.",
      kickoffHref: "/kickoff?orgId=org-1&season=2026",
      constraints: [],
      ruleNotes: [],
      designPriorities: [],
    },
    sources: [{ source: "statbotics", syncedAt: "2026-03-01T00:00:00.000Z", teamKey: "frc2337" }],
    computedAt: "2026-03-01T12:00:00.000Z",
    engine: ENGINE,
    productVersion: "test",
    ...overrides,
  };
}

function emptyView(): Extract<StrategyView, { status: "empty" }> {
  return {
    status: "empty",
    message: EMPTY_PREDICTION_COPY,
    steps: [],
    orgId: "org-1",
    eventKey: "2026mijac",
    eventName: "Jackson",
    teamNumber: 2337,
    tbaConfigured: true,
    engine: ENGINE,
    productVersion: "test",
  };
}

describe("briefingSectionsFromStrategyView", () => {
  it("maps a live recompute (cached EPA) into briefing sections", () => {
    const sections = briefingSectionsFromStrategyView(liveView());
    expect(sections).not.toBeNull();
    expect(sections?.prediction).toMatchObject({
      pRed: 0.62,
      pBlue: 0.38,
      modelVersion: "weighted-current-v1",
      scoredAt: "2026-03-01T12:00:00.000Z",
    });
    expect(sections?.prediction?.keyFactors).toEqual([
      { name: "Rating edge", alliance: "red", impact: 0.12, evidence: "season ratings" },
    ]);
    expect(sections?.plan?.title).toBe("Protect the auto");
    expect(sections?.plan?.priorities).toEqual(["Hold the barge"]);
    expect(sections?.scouted).toEqual([
      {
        teamKey: "frc254",
        scoutSample: 4,
        autoCapability: 0.8,
        teleopCapability: 0.7,
        endgameCapability: 0.6,
        defenseLikely: false,
        foulRate: 0.1,
        pitNotes: ["swerve"],
      },
    ]);
    expect(sections?.tendencies).toEqual([{ teamKey: "frc254", labels: ["cycle"], evidence: ["fast feeder"] }]);
  });

  it("keeps empty EPA empty — never a 50% guess", () => {
    const coinFlip = briefingSectionsFromStrategyView(
      liveView({
        prediction: {
          matchKey: "2026mijac_qm1",
          modelVersion: "weighted-current-v1",
          pRed: 0.5,
          pBlue: 0.5,
          confidenceLow: 0.4,
          confidenceHigh: 0.6,
          effectiveSampleSize: 0,
          keyFactors: [],
          caveats: [],
        },
        sources: [],
      }),
    );
    expect(coinFlip).toBeNull();

    const demoOnly = briefingSectionsFromStrategyView(
      liveView({
        sources: [{ source: "DEMO", syncedAt: "2026-03-01T00:00:00.000Z", teamKey: "frc9999" }],
      }),
    );
    expect(demoOnly).toBeNull();
    expect(JSON.stringify(demoOnly)).not.toMatch(/0\.5/);
  });

  it("returns null for empty / setup views", () => {
    expect(briefingSectionsFromStrategyView(emptyView())).toBeNull();
    expect(
      briefingSectionsFromStrategyView({
        status: "setup_required",
        message: "Choose your team.",
        steps: [],
        orgId: null,
        eventKey: null,
        eventName: null,
        teamNumber: null,
        tbaConfigured: false,
      }),
    ).toBeNull();
  });
});

describe("refreshBriefingPrediction", () => {
  beforeEach(() => {
    recomputeMock.mockReset();
  });

  it("calls recomputeStrategyView the same way /api/strategy?refresh=1 does", async () => {
    recomputeMock.mockResolvedValueOnce(liveView());
    const client = { query: vi.fn() } as never;
    const sections = await refreshBriefingPrediction(client, {
      userId: "user-1",
      orgId: "org-1",
      matchKey: "2026mijac_qm1",
    });
    expect(recomputeMock).toHaveBeenCalledWith(client, {
      userId: "user-1",
      requestedOrg: "org-1",
      matchKey: "2026mijac_qm1",
    });
    expect(sections?.prediction?.pRed).toBe(0.62);
  });

  it("returns null when recompute yields empty EPA", async () => {
    recomputeMock.mockResolvedValueOnce(emptyView());
    const sections = await refreshBriefingPrediction({ query: vi.fn() } as never, {
      userId: "user-1",
      orgId: "org-1",
      matchKey: "2026mijac_qm1",
    });
    expect(sections).toBeNull();
  });

  it("returns null when recompute throws — never fabricates a prediction", async () => {
    recomputeMock.mockRejectedValueOnce(new Error("cache down"));
    const sections = await refreshBriefingPrediction({ query: vi.fn() } as never, {
      userId: "user-1",
      orgId: "org-1",
      matchKey: "2026mijac_qm1",
    });
    expect(sections).toBeNull();
  });
});
