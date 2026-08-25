import { describe, expect, it } from "vitest";
import type { DeviceClass, ProductEventInput } from "./events";
import { createTracker, type FlushReason } from "./tracker";

type Harness = {
  sent: Array<{ events: ProductEventInput[]; reason: FlushReason }>;
  runTimers: () => void;
  timersArmed: () => number;
  setConsent: (value: boolean) => void;
};

function harness(options?: { consent?: boolean; deviceClass?: DeviceClass; sendThrows?: boolean }) {
  let consent = options?.consent ?? true;
  const sent: Harness["sent"] = [];
  let pendingTimers: Array<() => void> = [];

  const tracker = createTracker({
    hasConsent: () => consent,
    send: (events, reason) => {
      if (options?.sendThrows) throw new Error("network down");
      sent.push({ events, reason });
    },
    deviceClass: () => options?.deviceClass ?? "desktop",
    setTimer: (fn) => {
      pendingTimers.push(fn);
      return pendingTimers.length - 1;
    },
    clearTimer: () => {
      pendingTimers = [];
    },
    flushDelayMs: 1000,
  });

  const control: Harness = {
    sent,
    runTimers: () => {
      const due = pendingTimers;
      pendingTimers = [];
      for (const fn of due) fn();
    },
    timersArmed: () => pendingTimers.length,
    setConsent: (value) => {
      consent = value;
    },
  };

  return { tracker, control };
}

describe("tracker consent gating", () => {
  // The load-bearing test of this whole workstream.
  it("emits absolutely nothing without consent", () => {
    const { tracker, control } = harness({ consent: false });

    tracker.track("page_view", "/scouting");
    tracker.track("feature_action", "/scouting", { feature: "scouting", action: "save" });
    tracker.track("ai_invoked", "/ai");

    expect(tracker.pending(), "nothing may even be queued").toBe(0);
    expect(control.timersArmed(), "no flush may be scheduled").toBe(0);

    tracker.flush("manual");
    control.runTimers();
    expect(control.sent).toHaveLength(0);
  });

  it("does not replay activity gathered before consent was given", () => {
    const { tracker, control } = harness({ consent: false });
    tracker.track("page_view", "/scouting");
    tracker.track("page_view", "/strategy");

    // The user now says yes. The earlier browsing must stay unrecorded, because
    // it happened while the answer was no.
    control.setConsent(true);
    tracker.flush("manual");
    expect(control.sent).toHaveLength(0);

    tracker.track("page_view", "/pit");
    tracker.flush("manual");
    expect(control.sent).toHaveLength(1);
    expect(control.sent[0].events.map((event) => event.path)).toEqual(["/pit"]);
  });

  it("drops a queued batch if consent is withdrawn before the flush", () => {
    const { tracker, control } = harness({ consent: true });
    tracker.track("page_view", "/scouting");
    expect(tracker.pending()).toBe(1);

    control.setConsent(false);
    control.runTimers();

    expect(control.sent).toHaveLength(0);
    expect(tracker.pending()).toBe(0);
  });

  it("treats a throwing consent check as a no", () => {
    const sent: ProductEventInput[][] = [];
    const tracker = createTracker({
      hasConsent: () => {
        throw new Error("cookie jar exploded");
      },
      send: (events) => sent.push(events),
      deviceClass: () => "desktop",
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    tracker.track("page_view", "/scouting");
    expect(tracker.pending()).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("tracker batching", () => {
  it("queues rather than sending, so a click never waits on a network call", () => {
    const { tracker, control } = harness();
    tracker.track("page_view", "/scouting");
    expect(control.sent, "send must not happen inline").toHaveLength(0);
    expect(tracker.pending()).toBe(1);
    expect(control.timersArmed()).toBe(1);
  });

  it("flushes the whole batch when the timer fires", () => {
    const { tracker, control } = harness();
    tracker.track("page_view", "/scouting");
    tracker.track("feature_open", "/scouting");
    control.runTimers();

    expect(control.sent).toHaveLength(1);
    expect(control.sent[0].reason).toBe("timer");
    expect(control.sent[0].events).toHaveLength(2);
    expect(tracker.pending()).toBe(0);
  });

  it("arms only one timer for a burst of events", () => {
    const { tracker, control } = harness();
    for (let i = 0; i < 5; i += 1) tracker.track("feature_action", "/scouting", { action: "tap" });
    expect(control.timersArmed()).toBe(1);
  });

  it("flushes early once the batch is full", () => {
    const { tracker, control } = harness();
    for (let i = 0; i < 40; i += 1) tracker.track("page_view", "/scouting");
    expect(control.sent).toHaveLength(1);
    expect(control.sent[0].reason).toBe("full");
    expect(control.sent[0].events).toHaveLength(40);
  });

  it("does nothing on a flush with an empty queue", () => {
    const { tracker, control } = harness();
    tracker.flush("unload");
    expect(control.sent).toHaveLength(0);
  });

  it("normalises the path and sanitises meta before queueing", () => {
    const { tracker, control } = harness({ deviceClass: "phone" });
    tracker.track("feature_action", "/team/4242/hours?member=amy", {
      feature: "hours",
      note: "Amy asked whether her Tuesday shift counted toward the total",
    });
    control.runTimers();

    expect(control.sent[0].events[0]).toEqual({
      event: "feature_action",
      path: "/team/:id/hours",
      deviceClass: "phone",
      meta: { feature: "hours" },
    });
  });

  it("records unknown rather than guessing when the device class lookup fails", () => {
    const sent: ProductEventInput[][] = [];
    const tracker = createTracker({
      hasConsent: () => true,
      send: (events) => sent.push(events),
      deviceClass: () => {
        throw new Error("no window");
      },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    tracker.track("page_view", "/scouting");
    tracker.flush("manual");
    expect(sent[0][0].deviceClass).toBe("unknown");
  });
});

describe("tracker failure behaviour", () => {
  it("swallows a failing send and does not retry forever", () => {
    const { tracker, control } = harness({ sendThrows: true });
    tracker.track("page_view", "/scouting");
    expect(() => control.runTimers()).not.toThrow();
    // The batch is gone, not re-queued: analytics must never grow into a
    // background loop that outlives its usefulness.
    expect(tracker.pending()).toBe(0);
  });

  it("survives a timer scheduler that throws", () => {
    const sent: ProductEventInput[][] = [];
    const tracker = createTracker({
      hasConsent: () => true,
      send: (events) => sent.push(events),
      deviceClass: () => "desktop",
      setTimer: () => {
        throw new Error("no timers here");
      },
      clearTimer: () => undefined,
    });
    expect(() => tracker.track("page_view", "/scouting")).not.toThrow();
    tracker.flush("manual");
    expect(sent).toHaveLength(1);
  });
});
