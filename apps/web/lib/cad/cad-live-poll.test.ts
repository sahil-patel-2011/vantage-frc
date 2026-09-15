import { describe, expect, it } from "vitest";
import {
  CAD_LIVE_POLL_MAX_MS,
  CAD_LIVE_POLL_MS,
  mergeCadLiveSession,
  nextCadLivePollDelayMs,
  shouldPollCadLiveSession,
} from "./cad-live-poll";
import type { AgentState } from "../../app/cad/cad-model";

const BASE: AgentState = {
  onshapeConfigured: true,
  onshapeConnected: true,
  bound: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
  iframeUrl: null,
  openUrl: null,
  messages: [{ role: "user", text: "plate" }],
  steps: [],
};

describe("cad live session poll", () => {
  it("polls only while Working in Onshape and keeps optimistic chat until GET catches up", () => {
    expect(CAD_LIVE_POLL_MS).toBe(800);
    expect(nextCadLivePollDelayMs(0)).toBe(800);
    expect(nextCadLivePollDelayMs(1)).toBe(1600);
    expect(nextCadLivePollDelayMs(3)).toBe(CAD_LIVE_POLL_MAX_MS);
    expect(shouldPollCadLiveSession("chat")).toBe(true);
    expect(shouldPollCadLiveSession("load")).toBe(false);
    expect(shouldPollCadLiveSession(null)).toBe(false);

    const incoming: AgentState = {
      ...BASE,
      messages: [],
      steps: [{ index: 1, tool: "sketch", label: "plate", title: "Plate", detail: "", status: "done", featureId: null, at: "2026-09-15T00:00:00.000Z" }],
    };
    const merged = mergeCadLiveSession(BASE, incoming);
    expect(merged.messages).toEqual(BASE.messages);
    expect(merged.steps).toHaveLength(1);

    const caughtUp = mergeCadLiveSession(BASE, {
      ...incoming,
      messages: [
        { role: "user", text: "plate" },
        { role: "assistant", text: "sketched" },
      ],
    });
    expect(caughtUp.messages).toHaveLength(2);
  });

  it("does not wipe current steps when the mid-turn GET has not checkpointed yet", () => {
    const current: AgentState = {
      ...BASE,
      steps: [
        {
          index: 1,
          tool: "sketch",
          label: "plate",
          title: "Plate",
          detail: "",
          status: "done",
          featureId: null,
          at: "2026-09-15T00:00:00.000Z",
        },
      ],
    };
    const merged = mergeCadLiveSession(current, { ...BASE, messages: [], steps: [] });
    expect(merged.steps).toHaveLength(1);
    expect(merged.messages).toEqual(current.messages);
  });
});
