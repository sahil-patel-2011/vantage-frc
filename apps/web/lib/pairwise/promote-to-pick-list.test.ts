import { beforeEach, describe, expect, it, vi } from "vitest";
import { rankPairwise } from "./rank";
import {
  bucketOrDefault,
  pairwisePromotePayload,
  promotePairwiseOrder,
} from "./promote-to-pick-list";

const listPickListsMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const ensurePickListMock = vi.fn(async () => "created-list");
const upsertEntryMock = vi.fn(
  async (_client: unknown, input: { teamKey: string | number; pickListId: string }) => {
    if (String(input.teamKey) === "frc9999") {
      throw new Error("9999 is not in the official team list yet — sync the event first.");
    }
    return `entry-${input.teamKey}`;
  },
);
const reorderEntryMock = vi.fn(async () => ({ conflict: null, snapshot: null }));

vi.mock("../picklist", async () => {
  const actual = await vi.importActual<typeof import("../picklist")>("../picklist");
  return {
    ...actual,
    listPickLists: () => listPickListsMock(),
    ensurePickList: (...args: unknown[]) => ensurePickListMock(...(args as [never, never])),
    upsertEntry: (...args: unknown[]) => upsertEntryMock(...(args as [never, never])),
    reorderEntry: (...args: unknown[]) => reorderEntryMock(...(args as [never, never])),
  };
});

const client = {} as never;

beforeEach(() => {
  upsertEntryMock.mockClear();
  reorderEntryMock.mockClear();
  ensurePickListMock.mockClear();
  listPickListsMock.mockReset();
  listPickListsMock.mockResolvedValue([]);
});

describe("pairwisePromotePayload", () => {
  it("stays empty when nobody has tapped — no DEMO ranks", () => {
    const fromEmptyRanker = pairwisePromotePayload(rankPairwise([]));
    expect(fromEmptyRanker).toEqual({ teamKeys: [], rejected: [], notesByTeam: {} });
    expect(fromEmptyRanker.teamKeys).toHaveLength(0);
    expect(JSON.stringify(fromEmptyRanker)).not.toMatch(/demo/i);
  });

  it("builds a promote payload in Bradley-Terry order from real taps", () => {
    const ranks = rankPairwise([
      { winnerTeamNumber: 254, loserTeamNumber: 1678 },
      { winnerTeamNumber: 254, loserTeamNumber: 1678 },
      { winnerTeamNumber: 1678, loserTeamNumber: 118 },
    ]);
    const payload = pairwisePromotePayload(ranks, "Driver skill");
    expect(payload.teamKeys).toEqual(["frc254", "frc1678", "frc118"]);
    expect(payload.rejected).toEqual([]);
    expect(payload.notesByTeam.frc254).toMatch(/Pairwise #1/);
    expect(payload.notesByTeam.frc254).toContain("Driver skill");
    expect(JSON.stringify(payload)).not.toMatch(/demo/i);
  });

  it("reports junk team numbers instead of inventing a field", () => {
    const payload = pairwisePromotePayload([
      { teamNumber: 254, rank: 1 },
      { teamNumber: 0, rank: 2 },
    ]);
    expect(payload.teamKeys).toEqual(["frc254"]);
    expect(payload.rejected).toEqual(["0"]);
  });
});

describe("bucketOrDefault", () => {
  it("keeps a valid bucket and falls back for anything else", () => {
    expect(bucketOrDefault("first_pick")).toBe("first_pick");
    expect(bucketOrDefault("nonsense")).toBe("unranked");
  });
});

describe("promotePairwiseOrder", () => {
  it("does not create a pick list or write entries when ranks are empty", async () => {
    const result = await promotePairwiseOrder(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      ranks: [],
    });
    expect(result.pickListId).toBeNull();
    expect(result.promoted).toEqual([]);
    expect(result.message).toMatch(/empty until/i);
    expect(listPickListsMock).not.toHaveBeenCalled();
    expect(ensurePickListMock).not.toHaveBeenCalled();
    expect(upsertEntryMock).not.toHaveBeenCalled();
    expect(reorderEntryMock).not.toHaveBeenCalled();
  });

  it("writes the tap order onto the canonical list and applies that order", async () => {
    const ranks = rankPairwise([
      { winnerTeamNumber: 254, loserTeamNumber: 1678 },
      { winnerTeamNumber: 1678, loserTeamNumber: 118 },
    ]);
    const result = await promotePairwiseOrder(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      ranks,
      criterionName: "Defense",
      bucket: "first_pick",
    });
    expect(result.pickListId).toBe("created-list");
    expect(result.promoted).toEqual(["frc254", "frc1678", "frc118"]);
    expect(result.bucket).toBe("first_pick");
    expect(result.rejected).toEqual([]);
    expect(result.message).toContain("254, 1678, 118");
    expect(upsertEntryMock.mock.calls.map((call) => call[1])).toMatchObject([
      { pickListId: "created-list", teamKey: "frc254", bucket: "first_pick" },
      { pickListId: "created-list", teamKey: "frc1678", bucket: "first_pick" },
      { pickListId: "created-list", teamKey: "frc118", bucket: "first_pick" },
    ]);
    expect(reorderEntryMock.mock.calls.map((call) => call[1])).toMatchObject([
      { entryId: "entry-frc118", toIndex: 0 },
      { entryId: "entry-frc1678", toIndex: 0 },
      { entryId: "entry-frc254", toIndex: 0 },
    ]);
  });

  it("joins the event's existing pick list rather than creating a second one", async () => {
    listPickListsMock.mockResolvedValue([{ id: "desk-list" }]);
    const result = await promotePairwiseOrder(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      ranks: [{ teamNumber: 254, rank: 1 }],
    });
    expect(result.pickListId).toBe("desk-list");
    expect(ensurePickListMock).not.toHaveBeenCalled();
    expect(upsertEntryMock.mock.calls[0]![1]).toMatchObject({
      pickListId: "desk-list",
      bucket: "unranked",
    });
  });

  it("reports unsynced teams rather than failing the whole save", async () => {
    const result = await promotePairwiseOrder(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      ranks: [
        { teamNumber: 254, rank: 1 },
        { teamNumber: 9999, rank: 2 },
      ],
    });
    expect(result.promoted).toEqual(["frc254"]);
    expect(result.rejected).toEqual(["frc9999"]);
    expect(result.message).toContain("sync the event teams first");
  });

  it("refuses to promote without an active event once ranks exist", async () => {
    await expect(
      promotePairwiseOrder(client, {
        orgId: "org-1",
        userId: "user-1",
        eventKey: null,
        ranks: [{ teamNumber: 254, rank: 1 }],
      }),
    ).rejects.toThrow(/active event/i);
    expect(upsertEntryMock).not.toHaveBeenCalled();
  });
});
