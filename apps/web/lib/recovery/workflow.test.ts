import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoveryJournalWorkflow } from "./workflow";
const fake = vi.hoisted(() => ({ export: vi.fn(), sleep: vi.fn() }));
vi.mock("./journal", () => ({ exportRecoveryJournal: fake.export }));
vi.mock("workflow", () => ({ sleep: fake.sleep }));

describe("bounded recovery work", () => {
  beforeEach(() => { vi.clearAllMocks(); fake.sleep.mockResolvedValue(undefined); });
  it.each(["current", "busy", "not_configured"])("stops immediately for %s rather than paying for more timers and steps", async state => {
    fake.export.mockResolvedValue({ state });
    await recoveryJournalWorkflow();
    expect(fake.export).toHaveBeenCalledOnce();
    expect(fake.sleep).not.toHaveBeenCalled();
  });
  it("keeps bounded near-real-time exports when actual changes remain", async () => {
    fake.export.mockResolvedValue({ state: "verified" });
    await recoveryJournalWorkflow();
    expect(fake.export).toHaveBeenCalledTimes(3);
    expect(fake.sleep.mock.calls).toEqual([["20s"], ["20s"]]);
  });
});
