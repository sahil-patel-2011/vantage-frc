import { describe, expect, it } from "vitest";
import {
  canDismissPackingRequest,
  canManagePackingMaster,
  groupPacking,
  packProgress,
  PACKING_TEMPLATE,
  parsePackingAction,
  pendingPackingRequests,
  type PackingItem,
  type PackingRequest,
} from "./packing";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<PackingItem>): PackingItem {
  return {
    id: "i1",
    listId: ID,
    category: "Batteries & Power",
    label: "Competition batteries (charged)",
    quantity: 6,
    packed: false,
    packedByName: null,
    packedAt: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("PACKING_TEMPLATE", () => {
  it("covers the core load-out areas with unique labels", () => {
    const categories = PACKING_TEMPLATE.map((entry) => entry.category);
    expect(categories).toContain("Batteries & Power");
    expect(categories).toContain("Tools & Pit");
    expect(categories).toContain("Eliminations cart");
    expect(categories).toContain("Inspection binder");
    expect(categories).toContain("Driver Station field kit");
    const labels = PACKING_TEMPLATE.flatMap((entry) => entry.items.map((entryItem) => entryItem.label));
    expect(labels.length).toBeGreaterThanOrEqual(20);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.some((label) => /hook-and-loop/i.test(label))).toBe(true);
    expect(labels.some((label) => /pigtail|dongle/i.test(label))).toBe(true);
    expect(labels.some((label) => /metal buckle/i.test(label))).toBe(true);
    expect(labels.some((label) => /player station/i.test(label))).toBe(true);
    expect(labels.some((label) => /strain-relief/i.test(label))).toBe(true);
    expect(labels.some((label) => /main breaker/i.test(label))).toBe(true);
    expect(labels.some((label) => /microfiber/i.test(label))).toBe(true);
    expect(labels.some((label) => /Loctite 425/i.test(label))).toBe(true);
    expect(labels.some((label) => /Loctite 242/i.test(label))).toBe(true);
    expect(labels.some((label) => /Battery-box foam/i.test(label))).toBe(true);
    expect(labels.some((label) => /R601/i.test(label) && /vent/i.test(label))).toBe(true);
    expect(labels.some((label) => /Pneumatic vent plug/i.test(label))).toBe(true);
    expect(labels.some((label) => /Spare PDH/i.test(label))).toBe(true);
    expect(labels.some((label) => /ferrule/i.test(label))).toBe(true);
    expect(labels.some((label) => /heat shrink/i.test(label))).toBe(true);
    expect(labels.some((label) => /CANivore/i.test(label))).toBe(true);
    expect(labels.some((label) => /Shielded CANivore USB-C/i.test(label))).toBe(true);
    expect(labels.some((label) => /Endurance-class SD/i.test(label))).toBe(true);
    expect(labels.some((label) => /Wago 221/i.test(label) && /11 mm/i.test(label))).toBe(true);
    expect(labels.some((label) => /NEO encoder\/hall/i.test(label))).toBe(true);
    expect(labels.some((label) => /intake timing belts/i.test(label))).toBe(true);
    expect(labels.some((label) => /beater bar/i.test(label))).toBe(true);
    expect(labels.some((label) => /solid-core/i.test(label))).toBe(true);
    expect(labels.some((label) => /pressure switch/i.test(label) && /PCM\/PH/i.test(label))).toBe(true);
    expect(labels.some((label) => /70 psi/i.test(label) && /125 psi/i.test(label) && /R801/i.test(label))).toBe(true);
    expect(labels.some((label) => /1\/4 in OD/i.test(label) && /tubing/i.test(label))).toBe(true);
    expect(labels.some((label) => /1\/8 in NPT/i.test(label) && /solenoid/i.test(label))).toBe(true);
    expect(labels.some((label) => /working gauges/i.test(label) && /regulator/i.test(label))).toBe(true);
    expect(labels.some((label) => /Relieving regulator/i.test(label) && /non-relieving/i.test(label))).toBe(true);
    expect(labels.some((label) => /PoE injector/i.test(label) && /v1\.0/i.test(label))).toBe(true);
    expect(labels.some((label) => /TU07/i.test(label) && /10A PD branch/i.test(label))).toBe(true);
    expect(labels.some((label) => /through-bolts/i.test(label))).toBe(true);
    expect(labels.some((label) => /quick-release/i.test(label) && /removable/i.test(label))).toBe(true);
    expect(labels.some((label) => /not reversible/i.test(label))).toBe(true);
    expect(labels.some((label) => /3\.5 in/i.test(label) && /0\.25 in/i.test(label))).toBe(true);
    expect(labels.some((label) => /3\/4 in/i.test(label) && /staple/i.test(label))).toBe(true);
    expect(labels.some((label) => /Non-WCP load-rated zip ties/i.test(label))).toBe(true);
    expect(labels.some((label) => /main breaker cover/i.test(label))).toBe(true);
    expect(labels.some((label) => /ESD kit/i.test(label))).toBe(true);
    expect(labels.some((label) => /unused PDH/i.test(label) && /debris/i.test(label))).toBe(true);
    expect(labels.some((label) => /ATM 15A/i.test(label) && /20A/i.test(label) && /PCM\/PH/i.test(label))).toBe(true);
    expect(labels.some((label) => /ATC\/ATO/i.test(label) && /10A/i.test(label) && /R620-B/i.test(label))).toBe(true);
    expect(labels.some((label) => /ATO\/Maxi/i.test(label) && /40A/i.test(label))).toBe(true);
    expect(labels.some((label) => /Mini Power Module/i.test(label) && /R621/i.test(label))).toBe(true);
    expect(labels.some((label) => /Servo Hub/i.test(label) && /20A/i.test(label) && /R621/i.test(label))).toBe(true);
    expect(labels.some((label) => /Don't bury the PDH/i.test(label))).toBe(true);
    expect(labels.some((label) => /PCM\/PH/i.test(label) && /6 in/i.test(label) && /radio/i.test(label))).toBe(true);
    expect(labels.some((label) => /PCM\/PH/i.test(label) && /CAN drop/i.test(label))).toBe(true);
    expect(labels.some((label) => /Kraken power-connector/i.test(label))).toBe(true);
    expect(labels.some((label) => /1\.2/u.test(label) && /0\.9/u.test(label) && /torque/i.test(label))).toBe(true);
    expect(labels.some((label) => /Anderson/i.test(label) && /seated/i.test(label))).toBe(true);
    expect(labels.some((label) => /controller buttons/i.test(label))).toBe(true);
    expect(labels.some((label) => /60/.test(label) && /16/.test(label) && /78/.test(label))).toBe(true);
    expect(labels.some((label) => /unauthorized wireless/i.test(label))).toBe(true);
    expect(labels.some((label) => /Game Tools/i.test(label) && /26\.0/i.test(label))).toBe(true);
    expect(labels.some((label) => /Power-off card/i.test(label) && /0 psi/i.test(label))).toBe(true);
    expect(labels.some((label) => /2\.4 GHz/i.test(label) && /DIP 3/i.test(label))).toBe(true);
    expect(labels.some((label) => /110 in/i.test(label) && /30 in/i.test(label) && /12 in/i.test(label))).toBe(true);
    expect(labels.some((label) => /1\.25/i.test(label) && /5 in/i.test(label))).toBe(true);
    expect(labels.some((label) => /4\.25 in/i.test(label) && /R403/i.test(label))).toBe(true);
    expect(labels.some((label) => /1\.5 in/i.test(label) && /R404/i.test(label))).toBe(true);
    expect(labels.some((label) => /4\.25 in/i.test(label) && /R402/i.test(label))).toBe(true);
    expect(labels.some((label) => /cross-section/i.test(label) && /R402/i.test(label))).toBe(true);
    expect(labels.some((label) => /R406/i.test(label) && /2 in/i.test(label))).toBe(true);
    expect(labels.some((label) => /RSL/i.test(label) && /36 in/i.test(label))).toBe(true);
    expect(labels.some((label) => /high-contact shafts/i.test(label))).toBe(true);
  });
});

describe("packProgress", () => {
  it("computes percent and done", () => {
    expect(packProgress([item({ packed: true }), item({ id: "b", packed: false })])).toMatchObject({
      total: 2,
      packed: 1,
      percent: 50,
      done: false,
    });
    expect(packProgress([item({ packed: true })]).done).toBe(true);
    expect(packProgress([]).done).toBe(false);
  });
});

describe("groupPacking", () => {
  it("orders template categories first, unknown last", () => {
    const groups = groupPacking([
      item({ id: "1", category: "Snacks Extra" }),
      item({ id: "2", category: "Robot & Spares" }),
      item({ id: "3", category: "Team & Safety" }),
    ]);
    expect(groups.map((group) => group.category)).toEqual(["Robot & Spares", "Team & Safety", "Snacks Extra"]);
  });
});

describe("parsePackingAction", () => {
  it("creates a list with template seeding on by default", () => {
    expect(parsePackingAction({ action: "create_list", orgId: ORG, title: "Week 1 Regional" })).toMatchObject({
      action: "create_list",
      seedTemplate: true,
      eventKey: null,
    });
    expect(parsePackingAction({ action: "create_list", orgId: ORG, title: "x", seedTemplate: false })).toMatchObject({
      seedTemplate: false,
    });
  });
  it("validates item quantity as a positive integer", () => {
    expect(parsePackingAction({ action: "add_item", orgId: ORG, listId: ID, label: "Gaffer tape" })).toMatchObject({ quantity: 1 });
    expect(() => parsePackingAction({ action: "add_item", orgId: ORG, listId: ID, label: "x", quantity: 2.5 })).toThrow(/whole number/);
    expect(() => parsePackingAction({ action: "add_item", orgId: ORG, listId: ID, label: "x", quantity: 0 })).toThrow(/whole number/);
  });
  it("toggles and rejects unsupported actions", () => {
    expect(parsePackingAction({ action: "toggle_item", orgId: ORG, id: ID, packed: true })).toMatchObject({ packed: true });
    expect(() => parsePackingAction({ action: "vanish", orgId: ORG })).toThrow(/Unsupported/);
  });

  it("parses a packing-form request without putting it on the master list", () => {
    expect(
      parsePackingAction({
        action: "request_item",
        orgId: ORG,
        listId: ID,
        label: "Spare LIMELIGHT",
        note: "camera crate",
      }),
    ).toMatchObject({
      action: "request_item",
      label: "Spare LIMELIGHT",
      quantity: 1,
      note: "camera crate",
    });
    expect(parsePackingAction({ action: "accept_request", orgId: ORG, id: ID }).action).toBe("accept_request");
    expect(parsePackingAction({ action: "dismiss_request", orgId: ORG, id: ID }).action).toBe("dismiss_request");
  });
});

describe("packing request inbox", () => {
  const request = (overrides: Partial<PackingRequest>): PackingRequest => ({
    id: "r1",
    listId: ID,
    category: "Other",
    label: "Extra bumper bolts",
    quantity: 1,
    note: "",
    requestedBy: "33333333-3333-4333-8333-333333333333",
    requestedName: "Ada",
    status: "pending",
    createdAt: "2026-03-01T12:00:00.000Z",
    ...overrides,
  });

  it("lets only the list creator or an owner/admin manage the master list", () => {
    const lead = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const member = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(canManagePackingMaster("viewer", lead, lead)).toBe(true);
    expect(canManagePackingMaster("admin", lead, member)).toBe(true);
    expect(canManagePackingMaster("owner", lead, member)).toBe(true);
    expect(canManagePackingMaster("member", lead, member)).toBe(false);
  });

  it("lets the requester dismiss their own pending row", () => {
    const lead = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const member = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(canDismissPackingRequest("member", lead, member, member)).toBe(true);
    expect(canDismissPackingRequest("member", lead, member, lead)).toBe(false);
  });

  it("surfaces pending requests in created order and ignores decided rows", () => {
    const pending = pendingPackingRequests([
      request({ id: "later", createdAt: "2026-03-01T13:00:00.000Z" }),
      request({ id: "done", status: "accepted", createdAt: "2026-03-01T11:00:00.000Z" }),
      request({ id: "first", createdAt: "2026-03-01T12:00:00.000Z" }),
    ]);
    expect(pending.map((row) => row.id)).toEqual(["first", "later"]);
  });
});
