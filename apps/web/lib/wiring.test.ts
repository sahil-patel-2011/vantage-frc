import { describe, expect, it } from "vitest";
import { detectConflicts, parseWiringAction, pcmPhCanCues, summarizeWiring, validateDevice, type Device } from "./wiring";

const dev = (over: Partial<Device> & { name: string }): Device => ({
  id: over.name, name: over.name, deviceType: "talonfx", canId: null, canBus: "rio", pdhPort: null, ...over,
});

describe("validateDevice", () => {
  it("requires a name and valid type", () => {
    expect(validateDevice({ deviceType: "talonfx" }).ok).toBe(false);
    expect(validateDevice({ name: "Drive", deviceType: "nonsense" }).ok).toBe(false);
  });
  it("rejects an out-of-range CAN ID", () => {
    expect(validateDevice({ name: "Drive", deviceType: "talonfx", canId: 63 }).ok).toBe(false);
    expect(validateDevice({ name: "Drive", deviceType: "talonfx", canId: -1 }).ok).toBe(false);
  });
  it("accepts a valid device", () => {
    const result = validateDevice({ name: "FL Drive", deviceType: "talonfx", canId: 1, canBus: "rio", pdhPort: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.canId).toBe(1);
  });
});

describe("detectConflicts", () => {
  it("flags two same-type devices sharing a CAN ID on the same bus", () => {
    const conflicts = detectConflicts([
      dev({ name: "FL", deviceType: "talonfx", canId: 1, canBus: "rio" }),
      dev({ name: "FR", deviceType: "talonfx", canId: 1, canBus: "rio" }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "can_id", canId: 1 });
  });

  it("does NOT flag same CAN ID across different device types", () => {
    const conflicts = detectConflicts([
      dev({ name: "FL", deviceType: "talonfx", canId: 1 }),
      dev({ name: "Encoder", deviceType: "cancoder", canId: 1 }),
    ]);
    expect(conflicts.filter((c) => c.kind === "can_id")).toHaveLength(0);
  });

  it("does NOT flag same CAN ID on different buses", () => {
    const conflicts = detectConflicts([
      dev({ name: "FL", deviceType: "talonfx", canId: 1, canBus: "rio" }),
      dev({ name: "Arm", deviceType: "talonfx", canId: 1, canBus: "canivore" }),
    ]);
    expect(conflicts.filter((c) => c.kind === "can_id")).toHaveLength(0);
  });

  it("flags two devices on the same power port", () => {
    const conflicts = detectConflicts([
      dev({ name: "FL", canId: 1, pdhPort: 5 }),
      dev({ name: "FR", canId: 2, pdhPort: 5 }),
    ]);
    expect(conflicts.filter((c) => c.kind === "power_port")).toHaveLength(1);
  });
});

describe("pcmPhCanCues", () => {
  it("cues a logged PCM/PH with no CAN ID", () => {
    expect(pcmPhCanCues([dev({ name: "PH", deviceType: "ph", canId: null })])).toHaveLength(1);
    expect(pcmPhCanCues([dev({ name: "PCM", deviceType: "pcm", canId: null })])[0]).toMatch(/CAN bus/i);
    expect(JSON.stringify(pcmPhCanCues([dev({ name: "PH", deviceType: "ph", canId: null })])).toLowerCase()).not.toContain(
      "demo",
    );
  });

  it("does not invent a PCM or flag a module that already has a CAN ID", () => {
    expect(pcmPhCanCues([dev({ name: "FL", deviceType: "talonfx", canId: null })])).toHaveLength(0);
    expect(pcmPhCanCues([dev({ name: "PH", deviceType: "ph", canId: 1 })])).toHaveLength(0);
    expect(pcmPhCanCues([])).toHaveLength(0);
  });
});

describe("summarizeWiring", () => {
  it("counts CAN devices and surfaces conflicts", () => {
    const summary = summarizeWiring([
      dev({ name: "FL", deviceType: "talonfx", canId: 1 }),
      dev({ name: "FR", deviceType: "talonfx", canId: 1 }),
      dev({ name: "Radio", deviceType: "radio", canId: null }),
    ]);
    expect(summary.totalDevices).toBe(3);
    expect(summary.canDevices).toBe(2);
    expect(summary.conflictCount).toBe(1);
    expect(summary.pcmPhCanCues).toHaveLength(0);
  });

  it("surfaces a logged PH with no CAN ID", () => {
    expect(summarizeWiring([dev({ name: "PH", deviceType: "ph", canId: null })]).pcmPhCanCues).toHaveLength(1);
  });
});

describe("parseWiringAction", () => {
  it("parses create_device with a season year", () => {
    const action = parseWiringAction({ action: "create_device", orgId: "o1", seasonYear: 2026, name: "FL", deviceType: "talonfx", canId: 1 });
    expect(action).toMatchObject({ action: "create_device", name: "FL", canId: 1 });
  });
  it("rejects create_device without season year", () => {
    expect(() => parseWiringAction({ action: "create_device", orgId: "o1", name: "FL", deviceType: "talonfx" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseWiringAction({ action: "zap", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
