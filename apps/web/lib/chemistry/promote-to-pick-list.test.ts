import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bucketOrDefault,
  isChemistryPromoteAction,
  normalizeShortlist,
  partnerFitFromView,
  partnerFitJustification,
  partnerFitNotes,
  promoteChemistryShortlist,
  shouldAttachPartnerFit,
} from "./promote-to-pick-list";

const listPickListsMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const ensurePickListMock = vi.fn(async () => "created-list");
const setJustificationMock = vi.fn(async () => undefined);
const upsertEntryMock = vi.fn(
  async (_client: unknown, input: { teamKey: string | number; pickListId: string }) => {
    if (String(input.teamKey) === "frc9999") {
      throw new Error("9999 is not in the official team list yet — sync the event first.");
    }
    return `entry-${input.teamKey}`;
  },
);

vi.mock("../picklist", async () => {
  const actual = await vi.importActual<typeof import("../picklist")>("../picklist");
  return {
    ...actual,
    listPickLists: () => listPickListsMock(),
    ensurePickList: (...args: unknown[]) => ensurePickListMock(...(args as [never, never])),
    upsertEntry: (...args: unknown[]) => upsertEntryMock(...(args as [never, never])),
    setJustification: (...args: unknown[]) => setJustificationMock(...(args as [never, never])),
  };
});

const client = {} as never;

const realFit = {
  score: 72,
  modelVersion: "alliance-chemistry-v1" as const,
  complementarity: 85,
  totalEpa: 94.2,
  reliabilityBlend: 80,
  eventKey: "2026onto",
  allianceTeamKeys: ["frc254", "frc1678"],
};

beforeEach(() => {
  upsertEntryMock.mockClear();
  ensurePickListMock.mockClear();
  setJustificationMock.mockClear();
  listPickListsMock.mockReset();
  listPickListsMock.mockResolvedValue([]);
});

describe("normalizeShortlist", () => {
  it("canonicalizes mixed team inputs and drops duplicates in order", () => {
    const { teamKeys, rejected } = normalizeShortlist(["254", " frc1678 ", 118, "254"]);
    expect(teamKeys).toEqual(["frc254", "frc1678", "frc118"]);
    expect(rejected).toEqual([]);
  });

  it("reports junk instead of silently dropping it", () => {
    const { teamKeys, rejected } = normalizeShortlist(["254", "not-a-team", "", null, undefined]);
    expect(teamKeys).toEqual(["frc254"]);
    expect(rejected).toEqual(["not-a-team"]);
  });

  it("caps the shortlist so one click cannot flood the list", () => {
    const many = Array.from({ length: 40 }, (_, index) => String(index + 1));
    expect(normalizeShortlist(many, 12).teamKeys).toHaveLength(12);
  });
});

describe("bucketOrDefault", () => {
  it("keeps a valid bucket and falls back for anything else", () => {
    expect(bucketOrDefault("first_pick")).toBe("first_pick");
    expect(bucketOrDefault("nonsense")).toBe("unranked");
    expect(bucketOrDefault(undefined, "second_pick")).toBe("second_pick");
  });
});

describe("isChemistryPromoteAction", () => {
  it("accepts the save / promote aliases and rejects anything else", () => {
    expect(isChemistryPromoteAction("save-to-pick-list")).toBe(true);
    expect(isChemistryPromoteAction("promote")).toBe(true);
    expect(isChemistryPromoteAction("promote-partner-fit")).toBe(true);
    expect(isChemistryPromoteAction("export-csv")).toBe(false);
    expect(isChemistryPromoteAction(undefined)).toBe(false);
  });
});

describe("partnerFitNotes", () => {
  it("stays empty when chemistry has no real score — never DEMO", () => {
    expect(partnerFitNotes({ fit: { score: null } })).toBeNull();
    expect(partnerFitNotes({ fit: { score: Number.NaN } })).toBeNull();
    expect(partnerFitNotes({ notes: "  DEMO 72  " })).toBeNull();
    const blob = JSON.stringify(partnerFitNotes({ fit: { score: 72 } }));
    expect(blob).not.toMatch(/\bDEMO\b/i);
  });

  it("stamps a MODEL line from a real score and keeps caller notes", () => {
    expect(partnerFitNotes({ fit: realFit, notes: "Captain wants this seat" })).toBe(
      "Captain wants this seat Chemistry 72/100 partner fit (role fit 85, EPA 94.2). Verify with pit notes before locking the pick.",
    );
  });
});

describe("partnerFitJustification", () => {
  it("returns null without a real score so the desk stays honest", () => {
    expect(partnerFitJustification({ score: null })).toBeNull();
    expect(partnerFitJustification(null)).toBeNull();
  });

  it("cites the MODEL, never a TBA pick fact", () => {
    const result = partnerFitJustification(realFit);
    expect(result?.rationale).toContain("72/100");
    expect(result?.rationale).toContain("254, 1678");
    expect(result?.sources[0]?.kind).toBe("chemistry");
    expect(result?.rationale).not.toMatch(/\bDEMO\b/i);
    expect(result?.sources[0]?.detail).toMatch(/partner fit/i);
  });
});

describe("shouldAttachPartnerFit / partnerFitFromView", () => {
  it("attaches only when every requested seat is on the scored alliance", () => {
    expect(shouldAttachPartnerFit(["frc254"], ["frc254", "frc1678"])).toBe(true);
    expect(shouldAttachPartnerFit(["frc9999"], ["frc254", "frc1678"])).toBe(false);
    expect(shouldAttachPartnerFit([], ["frc254"])).toBe(false);
  });

  it("reads a live view and keeps a missing score as null", () => {
    expect(
      partnerFitFromView({
        teamKeys: ["frc254"],
        eventKey: "2026onto",
        chemistry: { score: 61, modelVersion: "alliance-chemistry-v1" },
      })?.score,
    ).toBe(61);
    expect(
      partnerFitFromView({
        teamKeys: ["frc254"],
        chemistry: { score: null },
      })?.score,
    ).toBeNull();
    expect(partnerFitFromView(null)).toBeNull();
  });
});

describe("promoteChemistryShortlist", () => {
  it("writes every valid seat onto the canonical list", async () => {
    const result = await promoteChemistryShortlist(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      teamKeys: ["254", "1678"],
      bucket: "first_pick",
    });
    expect(result.pickListId).toBe("created-list");
    expect(result.promoted).toEqual(["frc254", "frc1678"]);
    expect(result.bucket).toBe("first_pick");
    expect(result.rejected).toEqual([]);
    expect(result.message).toContain("254, 1678");
    expect(ensurePickListMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ source: "chemistry", eventKey: "2026onto" }),
    );
  });

  it("stamps source chemistry only when minting a new list", async () => {
    await promoteChemistryShortlist(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      teamKeys: ["254"],
    });
    expect(ensurePickListMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ source: "chemistry" }),
    );
    expect(ensurePickListMock.mock.calls[0]![1]).not.toMatchObject({ source: "strategy" });
  });

  it("joins the event's existing pick list rather than creating a second one", async () => {
    listPickListsMock.mockResolvedValue([{ id: "desk-list" }]);
    const result = await promoteChemistryShortlist(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      teamKeys: ["254"],
    });
    expect(result.pickListId).toBe("desk-list");
    expect(ensurePickListMock).not.toHaveBeenCalled();
    expect(upsertEntryMock.mock.calls[0]![1]).toMatchObject({
      pickListId: "desk-list",
      bucket: "unranked",
    });
  });

  it("writes MODEL partner-fit notes and justification onto the spine row", async () => {
    await promoteChemistryShortlist(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      teamKeys: ["254", "1678"],
      bucket: "first_pick",
      fit: realFit,
    });
    expect(upsertEntryMock.mock.calls[0]![1]).toMatchObject({
      notes: expect.stringContaining("72/100 partner fit"),
    });
    expect(setJustificationMock).toHaveBeenCalledTimes(2);
    expect(setJustificationMock.mock.calls[0]![1]).toMatchObject({
      pickListId: "created-list",
      entryId: "entry-frc254",
      contradictionFlagged: false,
    });
  });

  it("does not stamp alliance fit onto a suggestion that was not scored", async () => {
    await promoteChemistryShortlist(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      teamKeys: ["118"],
      fit: realFit,
    });
    expect(upsertEntryMock.mock.calls[0]![1].notes).toBeNull();
    expect(setJustificationMock).not.toHaveBeenCalled();
  });

  it("skips justification when chemistry has no score — never DEMO fit", async () => {
    await promoteChemistryShortlist(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      teamKeys: ["254"],
      fit: { score: null, allianceTeamKeys: ["frc254"] },
    });
    expect(upsertEntryMock.mock.calls[0]![1].notes).toBeNull();
    expect(setJustificationMock).not.toHaveBeenCalled();
  });

  it("reports unsynced teams rather than failing the whole save", async () => {
    const result = await promoteChemistryShortlist(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      teamKeys: ["254", "9999"],
    });
    expect(result.promoted).toEqual(["frc254"]);
    expect(result.rejected).toEqual(["frc9999"]);
    expect(result.message).toContain("sync the event teams first");
  });

  it("refuses an empty shortlist instead of creating a stray list", async () => {
    await expect(
      promoteChemistryShortlist(client, {
        orgId: "org-1",
        userId: "user-1",
        eventKey: "2026onto",
        teamKeys: ["", null],
      }),
    ).rejects.toThrow(/at least one valid team number/i);
    expect(ensurePickListMock).not.toHaveBeenCalled();
  });
});
