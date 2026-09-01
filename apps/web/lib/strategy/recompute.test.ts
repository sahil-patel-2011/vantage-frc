import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategyView } from "./types";

vi.mock("./compute-strategy", () => ({
  computeStrategyView: vi.fn(),
}));

import { computeStrategyView } from "./compute-strategy";
import {
  STRATEGY_RECOMPUTE_ACTION,
  briefingRequestsStrategyRefresh,
  finalizeStrategyRecompute,
  hasCachedEpa,
  isCachedEpaSource,
  isEmptyEpaCoinFlip,
  recomputeStrategyView,
} from "./recompute";

const computeMock = vi.mocked(computeStrategyView);

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
      keyFactors: [],
      caveats: [],
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
      strengthsToProtect: [],
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
    tendencies: [],
    pickListHints: [],
    scoutProvenance: [],
    operations: [],
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
    message: "No prediction yet — need a match schedule for your team at this event from TBA, plus team metrics.",
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

describe("briefingRequestsStrategyRefresh", () => {
  it("accepts explicit recompute / refresh from briefing or Strategy", () => {
    expect(briefingRequestsStrategyRefresh({ action: STRATEGY_RECOMPUTE_ACTION })).toBe(true);
    expect(briefingRequestsStrategyRefresh({ action: "refresh" })).toBe(true);
    expect(briefingRequestsStrategyRefresh({ refresh: true })).toBe(true);
    expect(briefingRequestsStrategyRefresh({ refresh: "1" })).toBe(true);
    expect(briefingRequestsStrategyRefresh({ refresh: "true" })).toBe(true);
  });

  it("does not treat ordinary load as a refresh", () => {
    expect(briefingRequestsStrategyRefresh({})).toBe(false);
    expect(briefingRequestsStrategyRefresh({ action: "save" })).toBe(false);
    expect(briefingRequestsStrategyRefresh({ refresh: "0" })).toBe(false);
    expect(briefingRequestsStrategyRefresh({ refresh: false })).toBe(false);
  });
});

describe("cached EPA sources", () => {
  it("accepts only Neon TBA / Statbotics rows", () => {
    expect(isCachedEpaSource("tba")).toBe(true);
    expect(isCachedEpaSource("Statbotics")).toBe(true);
    expect(isCachedEpaSource("DEMO")).toBe(false);
    expect(isCachedEpaSource("demo-statbotics")).toBe(false);
    expect(isCachedEpaSource("")).toBe(false);
    expect(isCachedEpaSource(null)).toBe(false);
  });

  it("hasCachedEpa ignores DEMO-only rows", () => {
    expect(hasCachedEpa([{ source: "demo" }])).toBe(false);
    expect(hasCachedEpa([{ source: "statbotics" }, { source: "DEMO" }])).toBe(true);
    expect(hasCachedEpa([])).toBe(false);
  });
});

describe("empty EPA stays empty — never 50%", () => {
  it("flags a 50/50 when no cached EPA exists", () => {
    expect(isEmptyEpaCoinFlip({ pRed: 0.5, pBlue: 0.5 }, [])).toBe(true);
    expect(isEmptyEpaCoinFlip({ pRed: 0.5, pBlue: 0.5 }, [{ source: "DEMO" }])).toBe(true);
  });

  it("keeps a real 50/50 when TBA/Statbotics EPA is present", () => {
    expect(isEmptyEpaCoinFlip({ pRed: 0.5, pBlue: 0.5 }, [{ source: "tba" }])).toBe(false);
    expect(isEmptyEpaCoinFlip({ pRed: 0.62, pBlue: 0.38 }, [{ source: "statbotics" }])).toBe(false);
  });

  it("downgrades a live 50/50 with no EPA to empty", () => {
    const result = finalizeStrategyRecompute(
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
    expect(result.status).toBe("empty");
    if (result.status !== "empty") return;
    expect(result.message).toMatch(/EPA/i);
    expect(result).not.toHaveProperty("prediction");
    expect(JSON.stringify(result)).not.toMatch(/0\.5/);
    expect(JSON.stringify(result)).not.toMatch(/DEMO/i);
  });

  it("downgrades DEMO-only sources to empty instead of a live win rate", () => {
    const result = finalizeStrategyRecompute(
      liveView({
        sources: [{ source: "DEMO", syncedAt: "2026-03-01T00:00:00.000Z", teamKey: "frc9999" }],
      }),
    );
    expect(result.status).toBe("empty");
    expect(JSON.stringify(result)).not.toMatch(/DEMO/i);
  });

  it("keeps a live board when Statbotics EPA is cached and strips DEMO rows", () => {
    const result = finalizeStrategyRecompute(
      liveView({
        sources: [
          { source: "statbotics", syncedAt: "2026-03-01T00:00:00.000Z", teamKey: "frc2337" },
          { source: "DEMO", syncedAt: null, teamKey: "frc0000" },
        ],
      }),
    );
    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.sources.map((row) => row.source)).toEqual(["statbotics"]);
    expect(result.prediction.pRed).toBe(0.62);
    expect(JSON.stringify(result)).not.toMatch(/DEMO/i);
  });

  it("passes through setup/empty compute results", () => {
    const empty = emptyView();
    expect(finalizeStrategyRecompute(empty)).toEqual(empty);
  });
});

describe("recomputeStrategyView", () => {
  beforeEach(() => {
    computeMock.mockReset();
  });

  it("re-runs computeStrategyView (predictMatch on Neon cache) and finalizes", async () => {
    computeMock.mockResolvedValueOnce(liveView());
    const client = { query: vi.fn() } as never;
    const view = await recomputeStrategyView(client, {
      userId: "user-1",
      requestedOrg: "org-1",
      matchKey: "2026mijac_qm1",
    });
    expect(computeMock).toHaveBeenCalledWith(client, {
      userId: "user-1",
      requestedOrg: "org-1",
      matchKey: "2026mijac_qm1",
    });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.prediction.pRed).toBe(0.62);
  });

  it("returns empty — not 50% — when the compute yields a coin-flip without EPA", async () => {
    computeMock.mockResolvedValueOnce(
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
    const view = await recomputeStrategyView({ query: vi.fn() } as never, {
      userId: "user-1",
      requestedOrg: "org-1",
    });
    expect(view.status).toBe("empty");
    expect(JSON.stringify(view)).not.toMatch(/DEMO/i);
    expect(view).not.toHaveProperty("prediction");
  });
});
