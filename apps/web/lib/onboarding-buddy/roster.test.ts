import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  OnboardingBuddyError,
  assertDistinctPair,
  assertRosterMembers,
  pairingInsertParams,
  parseCreatePairingInput,
  parseRosterUserId,
} from "./roster";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADA = "22222222-2222-4222-8222-222222222222";
const GRACE = "33333333-3333-4333-8333-333333333333";
const CREATED_BY = "11111111-1111-4111-8111-111111111111";

describe("parseRosterUserId", () => {
  it("accepts a roster UUID", () => {
    expect(parseRosterUserId(ADA, "New member")).toBe(ADA);
  });

  it("rejects DEMO / free-text identities", () => {
    for (const value of ["demo-user", "DEMO-NETWORK", "Ada Lovelace", "", "  ", "not-a-uuid"]) {
      expect(() => parseRosterUserId(value, "New member")).toThrow(/roster member id|required/i);
    }
    expect(() => parseRosterUserId(null, "Buddy")).toThrow(/required/i);
  });
});

describe("parseCreatePairingInput", () => {
  it("returns both roster user ids for a member-to-member row", () => {
    expect(
      parseCreatePairingInput({ newMemberId: ADA, buddyId: GRACE, notes: "  shop tour  " }),
    ).toEqual({ newMemberId: ADA, buddyId: GRACE, notes: "shop tour" });
  });

  it("refuses a self-pair and a DEMO network id", () => {
    expect(() => parseCreatePairingInput({ newMemberId: ADA, buddyId: ADA })).toThrow(
      /cannot be their own buddy/i,
    );
    expect(() =>
      parseCreatePairingInput({ newMemberId: "demo-user", buddyId: GRACE }),
    ).toThrow(/roster member id/i);
  });
});

describe("assertDistinctPair", () => {
  it("allows two different roster ids", () => {
    expect(() => assertDistinctPair(ADA, GRACE)).not.toThrow();
  });
});

describe("pairingInsertParams", () => {
  it("binds new_member_id and buddy_id as roster user ids", () => {
    const params = pairingInsertParams({
      orgId: ORG,
      newMemberId: ADA,
      buddyId: GRACE,
      notes: null,
      createdBy: CREATED_BY,
    });
    expect(params).toEqual([ORG, ADA, GRACE, null, CREATED_BY]);
    expect(params[1]).toBe(ADA);
    expect(params[2]).toBe(GRACE);
  });
});

describe("assertRosterMembers", () => {
  it("passes when every id has a memberships row", async () => {
    const query = vi.fn(async () => ({
      rows: [{ userId: ADA }, { userId: GRACE }],
      rowCount: 2,
    }));
    const client = { query } as unknown as PoolClient;

    await expect(assertRosterMembers(client, ORG, [ADA, GRACE])).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM memberships"),
      [ORG, [ADA, GRACE]],
    );
  });

  it("rejects an id that is not on this team's roster", async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [{ userId: ADA }], rowCount: 1 })),
    } as unknown as PoolClient;

    await expect(assertRosterMembers(client, ORG, [ADA, GRACE])).rejects.toBeInstanceOf(
      OnboardingBuddyError,
    );
  });
});
