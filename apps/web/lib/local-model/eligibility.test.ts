import { describe, expect, it } from "vitest";
import { LOCAL_MODELS, bestModelForMemory, humanSize, localModelById } from "./catalog";
import {
  consentCopy,
  downloadDecision,
  evaluateEligibility,
  type DeviceProfile,
} from "./eligibility";

const GOOD: DeviceProfile = {
  webgpu: true,
  memoryGb: 16,
  storageFreeBytes: 20_000_000_000,
  saveData: false,
  connection: "4g",
  metered: false,
};

describe("LOCAL_MODELS", () => {
  it("leads with a model whose licence has no strings", () => {
    // Vantage is commercial and multi-tenant. A restricted licence is not a
    // default however well the model scores.
    expect(LOCAL_MODELS[0]!.permissive).toBe(true);
  });

  it("says what tradeoff each one makes", () => {
    for (const model of LOCAL_MODELS) {
      expect(model.rationale.length, model.id).toBeGreaterThan(40);
      expect(model.licence.length, model.id).toBeGreaterThan(0);
      expect(model.downloadMb, model.id).toBeGreaterThan(0);
      expect(model.runtimeMb, model.id).toBeGreaterThanOrEqual(model.downloadMb);
    }
  });

  it("is ordered largest first, so memory selection can take the first that fits", () => {
    for (let i = 1; i < LOCAL_MODELS.length; i += 1) {
      expect(LOCAL_MODELS[i]!.runtimeMb).toBeLessThan(LOCAL_MODELS[i - 1]!.runtimeMb);
    }
  });

  it("looks up by id and returns null for anything else", () => {
    expect(localModelById(LOCAL_MODELS[0]!.id)?.id).toBe(LOCAL_MODELS[0]!.id);
    expect(localModelById("nope")).toBeNull();
    expect(localModelById(null)).toBeNull();
  });
});

describe("bestModelForMemory", () => {
  it("leaves half the machine for everything else the person has open", () => {
    // A model that fits only on an empty machine does not fit.
    const biggest = LOCAL_MODELS[0]!;
    expect(bestModelForMemory(biggest.runtimeMb * 2 + 10)?.id).toBe(biggest.id);
    expect(bestModelForMemory(biggest.runtimeMb + 10)?.id).not.toBe(biggest.id);
  });

  it("drops to the smaller model rather than crashing on the larger", () => {
    const smaller = LOCAL_MODELS[LOCAL_MODELS.length - 1]!;
    expect(bestModelForMemory(smaller.runtimeMb * 2 + 10)?.id).toBe(smaller.id);
  });

  it("returns nothing when nothing fits, rather than the smallest anyway", () => {
    // Telling someone their machine cannot do this is a real answer. Handing
    // them a model that will crash is not.
    expect(bestModelForMemory(100)).toBeNull();
  });

  it("takes the cautious pick when memory is unknown", () => {
    // Being wrong the other way means a crash mid-answer.
    expect(bestModelForMemory(null)?.id).toBe(LOCAL_MODELS[LOCAL_MODELS.length - 1]!.id);
  });
});

describe("evaluateEligibility", () => {
  it("accepts a capable machine and picks the best model it can hold", () => {
    const result = evaluateEligibility(GOOD);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.id).toBe(LOCAL_MODELS[0]!.id);
  });

  it("names the browser problem before anything else", () => {
    // Telling someone their connection is slow, when their browser could never
    // have run it anyway, wastes their time.
    const result = evaluateEligibility({
      ...GOOD,
      webgpu: false,
      connection: "2g",
      saveData: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.block).toBe("no-webgpu");
      expect(result.transient).toBe(false);
      expect(result.reason).toMatch(/graphics card/i);
    }
  });

  it("refuses a machine too small, and says it will not change", () => {
    const result = evaluateEligibility({ ...GOOD, memoryGb: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.block).toBe("too-little-memory");
      expect(result.transient).toBe(false);
    }
  });

  it("falls back to the smaller model on a modest machine, and says so", () => {
    // 3 GB leaves a 1.5 GB budget after the half kept for the browser, which
    // the larger model does not fit into and the smaller one does.
    const result = evaluateEligibility({ ...GOOD, memoryGb: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model.id).toBe(LOCAL_MODELS[LOCAL_MODELS.length - 1]!.id);
      expect(result.note).toMatch(/falling back/i);
    }
  });

  it("refuses to fill the last of someone's disk", () => {
    const result = evaluateEligibility({ ...GOOD, storageFreeBytes: 200_000_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.block).toBe("too-little-storage");
      expect(result.transient).toBe(true);
      expect(result.reason).toMatch(/free/i);
    }
  });

  it("respects data saver", () => {
    const result = evaluateEligibility({ ...GOOD, saveData: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.block).toBe("save-data");
      // Still offers the manual route: the person asked for less data, not for
      // the feature to be taken away.
      expect(result.reason).toMatch(/start the download yourself/i);
    }
  });

  it("waits for wifi rather than spending someone's phone data", () => {
    const result = evaluateEligibility({ ...GOOD, metered: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.block).toBe("metered");
  });

  it("waits out a slow connection", () => {
    for (const connection of ["slow-2g", "2g", "3g"]) {
      const result = evaluateEligibility({ ...GOOD, connection });
      expect(result.ok, connection).toBe(false);
      if (!result.ok) expect(result.block, connection).toBe("slow-connection");
    }
  });

  it("does not treat an unknown connection as a bad one", () => {
    expect(evaluateEligibility({ ...GOOD, connection: null }).ok).toBe(true);
  });

  it("does not treat unknown storage as full", () => {
    expect(evaluateEligibility({ ...GOOD, storageFreeBytes: null }).ok).toBe(true);
  });
});

describe("downloadDecision", () => {
  const base = { enabled: true, consented: false, cached: false, device: GOOD };

  it("does nothing when the feature is off", () => {
    const decision = downloadDecision({ ...base, enabled: false });
    expect(decision).toEqual({ auto: false, prompt: false, blocked: null });
  });

  it("asks once before the first download, even with the setting on", () => {
    // "On by default" is permission for the feature, not for a gigabyte to
    // leave the network the moment a page opens.
    const decision = downloadDecision(base);
    expect(decision.prompt).toBe(true);
    expect(decision.auto).toBe(false);
  });

  it("never asks again once someone has agreed on this machine", () => {
    const decision = downloadDecision({ ...base, consented: true });
    expect(decision.auto).toBe(true);
    expect(decision.prompt).toBe(false);
  });

  it("just loads a model that is already here", () => {
    const decision = downloadDecision({ ...base, cached: true });
    expect(decision.auto).toBe(true);
    expect(decision.prompt).toBe(false);
  });

  it("runs a cached model on a phone connection", () => {
    // The objection was always to the transfer, never to the model. Refusing to
    // use one already on disk would be cargo-culting the rule.
    const decision = downloadDecision({
      ...base,
      cached: true,
      device: { ...GOOD, metered: true },
    });
    expect(decision.auto).toBe(true);
    expect(decision.blocked).toBeNull();
  });

  it("still refuses a cached model the machine cannot run", () => {
    // Not being able to reach the GPU is not a transient objection to a
    // download; it means the thing will not work.
    const decision = downloadDecision({
      ...base,
      cached: true,
      device: { ...GOOD, webgpu: false },
    });
    expect(decision.auto).toBe(false);
    expect(decision.blocked?.block).toBe("no-webgpu");
  });

  it("surfaces the reason rather than failing silently", () => {
    const decision = downloadDecision({ ...base, device: { ...GOOD, webgpu: false } });
    expect(decision.blocked?.reason.length).toBeGreaterThan(20);
  });
});

describe("consentCopy", () => {
  it("states the cost before the benefit", () => {
    const copy = consentCopy(LOCAL_MODELS[0]!);
    expect(copy).toMatch(/download/i);
    expect(copy).toMatch(/stays on this machine/i);
    expect(copy.indexOf("download")).toBeLessThan(copy.indexOf("stays on this machine"));
  });
});

describe("humanSize", () => {
  it("uses megabytes below a gigabyte and gigabytes above", () => {
    expect(humanSize(720)).toBe("720 MB");
    expect(humanSize(1_100)).toBe("1.1 GB");
  });
});
