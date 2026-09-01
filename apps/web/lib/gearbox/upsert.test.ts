import { describe, expect, it } from "vitest";
import {
  GEARBOX_IDENTITY_UNIQUE_INDEX,
  gearboxIdentityKey,
  gearboxWriteFromUniqueViolation,
  isGearboxIdentityUniqueViolation,
  parseGearboxWrite,
  resolveGearboxWrite,
  resolveGearboxWriteAfterUniqueViolation,
  type ExistingGearboxRef,
} from "./upsert";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const incoming = {
  orgId: ORG,
  seasonYear: 2026,
  name: "SDS MK4i L2",
  subsystem: "Drivetrain",
};

function existing(over: Partial<ExistingGearboxRef> = {}): ExistingGearboxRef {
  return { id: "gb-1", ...incoming, ...over };
}

describe("gearboxIdentityKey", () => {
  it("treats name and subsystem as case-insensitive", () => {
    expect(gearboxIdentityKey(incoming)).toBe(
      gearboxIdentityKey({ ...incoming, name: "sds mk4i l2", subsystem: "drivetrain" }),
    );
  });

  it("keeps a different season or subsystem as a different gearbox", () => {
    expect(gearboxIdentityKey({ ...incoming, seasonYear: 2025 })).not.toBe(gearboxIdentityKey(incoming));
    expect(gearboxIdentityKey({ ...incoming, subsystem: "Elevator" })).not.toBe(gearboxIdentityKey(incoming));
  });
});

describe("resolveGearboxWrite — insert vs upsert", () => {
  it("inserts when nothing matches", () => {
    expect(resolveGearboxWrite(incoming, [])).toEqual({ kind: "insert" });
  });

  it("updates in place when the same org, season, name, and subsystem already exist", () => {
    expect(resolveGearboxWrite(incoming, [existing()])).toEqual({
      kind: "update",
      id: "gb-1",
      reason: "identity",
    });
  });

  it("does not insert a duplicate when the saved spelling differs only by case", () => {
    expect(resolveGearboxWrite({ ...incoming, name: "sds mk4i l2" }, [existing()])).toMatchObject({
      kind: "update",
      id: "gb-1",
    });
  });

  it("inserts when the name is new even if the subsystem matches", () => {
    expect(resolveGearboxWrite({ ...incoming, name: "SDS MK4i L3" }, [existing()])).toEqual({ kind: "insert" });
  });

  it("inserts the same name in a different season instead of overwriting last year", () => {
    expect(resolveGearboxWrite({ ...incoming, seasonYear: 2027 }, [existing()])).toEqual({ kind: "insert" });
  });

  it("inserts when the matching name lives in another org", () => {
    expect(resolveGearboxWrite(incoming, [existing({ orgId: OTHER })])).toEqual({ kind: "insert" });
  });

  it("prefers an explicit id so a rename updates the same row", () => {
    expect(
      resolveGearboxWrite({ ...incoming, name: "SDS MK4i L3", id: "gb-1" }, [existing()]),
    ).toEqual({ kind: "update", id: "gb-1", reason: "id" });
  });

  it("does not update another org's row even when the client sends that id", () => {
    expect(
      resolveGearboxWrite({ ...incoming, id: "gb-1" }, [existing({ orgId: OTHER })]),
    ).toEqual({ kind: "insert" });
  });

  it("falls back to the natural key when the sent id is gone", () => {
    expect(
      resolveGearboxWrite({ ...incoming, id: "missing" }, [existing({ id: "gb-2" })]),
    ).toEqual({ kind: "update", id: "gb-2", reason: "identity" });
  });
});

describe("parseGearboxWrite", () => {
  const body = {
    action: "save_gearbox",
    orgId: ORG,
    seasonYear: 2026,
    name: "SDS MK4i L2",
    stages: [{ driving: 14, driven: 50 }],
  };

  it("keeps save_gearbox without an id as an insert-shaped action", () => {
    const parsed = parseGearboxWrite(body);
    expect(parsed).toMatchObject({ action: "save_gearbox", name: "SDS MK4i L2" });
    expect("id" in parsed && parsed.action === "save_gearbox" ? parsed.id : undefined).toBeUndefined();
  });

  it("carries an explicit id so the API can update that row", () => {
    expect(parseGearboxWrite({ ...body, id: "gb-1" })).toMatchObject({ action: "save_gearbox", id: "gb-1" });
  });
});

describe("gearbox identity unique (0503)", () => {
  it("names the unique index that matches org + season + lower(name) + lower(subsystem)", () => {
    expect(GEARBOX_IDENTITY_UNIQUE_INDEX).toBe("gearboxes_identity_uidx");
    expect(gearboxIdentityKey(incoming).split("\0")).toEqual([
      incoming.orgId,
      String(incoming.seasonYear),
      incoming.name.toLowerCase(),
      incoming.subsystem.toLowerCase(),
    ]);
  });

  it("treats a 23505 on the identity index as the same gearbox, not a new insert", () => {
    const error = { code: "23505", constraint: GEARBOX_IDENTITY_UNIQUE_INDEX };
    expect(isGearboxIdentityUniqueViolation(error)).toBe(true);
    expect(gearboxWriteFromUniqueViolation(error, incoming, [existing()])).toEqual({
      kind: "update",
      id: "gb-1",
      reason: "identity",
    });
  });

  it("still updates when the winning row used different capitalization", () => {
    const error = {
      code: "23505",
      message: `duplicate key value violates unique constraint "${GEARBOX_IDENTITY_UNIQUE_INDEX}"`,
    };
    expect(
      gearboxWriteFromUniqueViolation(error, { ...incoming, name: "sds mk4i l2", subsystem: "drivetrain" }, [
        existing(),
      ]),
    ).toEqual({ kind: "update", id: "gb-1", reason: "identity" });
  });

  it("does not swallow a different unique violation as an identity update", () => {
    const pk = { code: "23505", constraint: "gearboxes_pkey" };
    expect(isGearboxIdentityUniqueViolation(pk)).toBe(false);
    expect(gearboxWriteFromUniqueViolation(pk, incoming, [existing()])).toBeNull();
  });

  it("does not treat a non-unique error as a race-insert", () => {
    expect(isGearboxIdentityUniqueViolation({ code: "23503", constraint: GEARBOX_IDENTITY_UNIQUE_INDEX })).toBe(false);
    expect(isGearboxIdentityUniqueViolation("duplicate")).toBe(false);
    expect(gearboxWriteFromUniqueViolation({ code: "23505" }, incoming, [existing()])).toBeNull();
  });

  it("resolves the losing concurrent insert to an update of the winner", () => {
    expect(resolveGearboxWriteAfterUniqueViolation(incoming, [existing({ id: "winner" })])).toEqual({
      kind: "update",
      id: "winner",
      reason: "identity",
    });
  });

  it("errors when the unique violation cannot be mapped to an existing identity", () => {
    expect(() => resolveGearboxWriteAfterUniqueViolation(incoming, [])).toThrow(
      /already saved for this subsystem/,
    );
  });
});
