import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATE_CACHE_TTL_MS, forgetOnboardingGate, readOnboardingGate } from "./onboarding-gate-cache";

const settled = { onboardingComplete: true, workspaceApproved: true, accessStatus: "approved" };
const pending = { onboardingComplete: true, workspaceApproved: false, accessStatus: "none" };
const noSleep = async () => undefined;

describe("the proxy's onboarding check", () => {
  beforeEach(() => forgetOnboardingGate());

  it("asks once per session for a settled answer, then again after 30 seconds", async () => {
    let clock = 1_000;
    const load = vi.fn(async () => settled);
    const options = { now: () => clock, sleep: noSleep };
    expect(await readOnboardingGate("s1", load, options)).toEqual(settled);
    expect(await readOnboardingGate("s1", load, options)).toEqual(settled);
    expect(load).toHaveBeenCalledTimes(1);
    clock += GATE_CACHE_TTL_MS;
    await readOnboardingGate("s1", load, options);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never remembers an unsettled answer, so approval is seen at once", async () => {
    const load = vi.fn(async () => pending);
    await readOnboardingGate("s2", load, { sleep: noSleep });
    await readOnboardingGate("s2", load, { sleep: noSleep });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one lookup when the same session is asked together", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(async () => {
      await gate;
      return settled;
    });
    const first = readOnboardingGate("s5", load, { sleep: noSleep });
    const second = readOnboardingGate("s5", load, { sleep: noSleep });
    release?.();
    expect(await first).toEqual(settled);
    expect(await second).toEqual(settled);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries a failed lookup once before giving up", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("max clients reached")).mockResolvedValueOnce(settled);
    expect(await readOnboardingGate("s3", load, { sleep: noSleep })).toEqual(settled);

    const failures: unknown[] = [];
    const broken = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await readOnboardingGate("s4", broken, { sleep: noSleep, onFailure: (error) => failures.push(error) })).toBeNull();
    expect(broken).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(1);
  });
});
