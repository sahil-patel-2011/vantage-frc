import { describe, expect, it } from "vitest";
import { fallbackReasonLabel, readRenderOutcome, renderReceiptFrom } from "./outcome";

describe("readRenderOutcome", () => {
  it("reads a model outcome from a route response", () => {
    const outcome = readRenderOutcome({
      status: "live",
      render: { mode: "model", feature: "pit_repair_triage", modelId: "claude-sonnet-4-5", provider: "anthropic", requestId: "r1" },
    });
    expect(outcome).toEqual({
      mode: "model",
      feature: "pit_repair_triage",
      modelId: "claude-sonnet-4-5",
      provider: "anthropic",
      fallbackReason: undefined,
      requestId: "r1",
    });
  });

  it("keeps the fallback reason of a template outcome", () => {
    const outcome = readRenderOutcome({ render: { mode: "template", fallbackReason: "cap_hit:payg_not_enabled" } });
    expect(outcome?.mode).toBe("template");
    expect(outcome?.fallbackReason).toBe("cap_hit:payg_not_enabled");
  });

  it("returns null for responses without a render, or with an unknown mode", () => {
    expect(readRenderOutcome({ status: "live" })).toBeNull();
    expect(readRenderOutcome({ render: { mode: "ai" } })).toBeNull();
    expect(readRenderOutcome(null)).toBeNull();
    expect(readRenderOutcome("nope")).toBeNull();
  });
});

describe("renderReceiptFrom", () => {
  it("stamps the receipt with the time the client received it", () => {
    const receipt = renderReceiptFrom({ render: { mode: "template", fallbackReason: "no_provider" } }, "2026-09-02T00:00:00.000Z");
    expect(receipt).toEqual({
      render: {
        mode: "template",
        feature: undefined,
        modelId: undefined,
        provider: undefined,
        fallbackReason: "no_provider",
        requestId: undefined,
      },
      at: "2026-09-02T00:00:00.000Z",
    });
    expect(renderReceiptFrom({ ok: true })).toBeNull();
  });
});

describe("fallbackReasonLabel", () => {
  it("maps the fallback taxonomy to plain language, including cap_hit suffixes", () => {
    expect(fallbackReasonLabel("no_provider")).toBe("no AI provider is configured for this team");
    expect(fallbackReasonLabel("cap_hit:payg_not_enabled")).toBe("the team's AI spend cap was reached (payg not enabled)");
    expect(fallbackReasonLabel("deterministic_only")).toBe("this output is fully computed from your data");
    expect(fallbackReasonLabel("something_new")).toBe("the template stood in (something_new)");
    expect(fallbackReasonLabel(undefined)).toBeNull();
  });
});
