import { describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTICE, jobStalled, noticeEmailText, readBroadcastJob, runBroadcast, type BroadcastJob } from "./broadcast";
import { bannerMessage } from "./notice";
import { MemoryOutageStore } from "./status-store";

function job(overrides: Partial<BroadcastJob> = {}): BroadcastJob {
  return {
    v: 1,
    kind: "limited",
    seq: 1,
    audience: "everyone",
    subject: DEFAULT_NOTICE.limited.subject,
    total: 5,
    sent: 0,
    failed: 0,
    nextIndex: 0,
    startedAt: "2026-10-11T12:00:00.000Z",
    updatedAt: "2026-10-11T12:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

describe("runBroadcast", () => {
  it("emails each person on their own, two at a time with a pause, and saves progress", async () => {
    const store = new MemoryOutageStore();
    const recipients = ["a@x.io", "b@x.io", "c@x.io", "d@x.io", "e@x.io"];
    const sent: Array<{ to: string; text: string }> = [];
    const progress: number[] = [];
    const sleep = vi.fn(async () => {
      progress.push((await readBroadcastJob(store, "incident_1", "limited"))?.nextIndex ?? -1);
    });
    const done = await runBroadcast({
      store,
      incidentId: "incident_1",
      job: job(),
      recipients,
      message: DEFAULT_NOTICE.limited.message,
      send: async (to, _subject, text) => {
        sent.push({ to, text });
      },
      sleep,
    });
    expect(sent.map((row) => row.to)).toEqual(recipients);
    expect(sent[0]!.text).toContain("Scouting you record keeps saving on your phone");
    expect(sent[0]!.text).toMatch(/one-off service notice/);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([2, 4]);
    expect(done).toMatchObject({ sent: 5, failed: 0, nextIndex: 5 });
    expect(done.finishedAt).not.toBeNull();
    expect(await readBroadcastJob(store, "incident_1", "limited")).toMatchObject({ sent: 5, finishedAt: done.finishedAt });
  });

  it("retries a refused send once, then counts it as failed and carries on", async () => {
    const store = new MemoryOutageStore();
    const attempts = new Map<string, number>();
    const done = await runBroadcast({
      store,
      incidentId: "incident_1",
      job: job({ total: 3 }),
      recipients: ["a@x.io", "bad@x.io", "c@x.io"],
      message: "Hello",
      send: async (to) => {
        attempts.set(to, (attempts.get(to) ?? 0) + 1);
        if (to === "bad@x.io") throw new Error("Email provider returned 429");
      },
      sleep: async () => undefined,
    });
    expect(attempts.get("bad@x.io")).toBe(2);
    expect(done).toMatchObject({ sent: 2, failed: 1, nextIndex: 3 });
  });

  it("continues from where a cut-off run stopped", async () => {
    const store = new MemoryOutageStore();
    const sent: string[] = [];
    await runBroadcast({
      store,
      incidentId: "incident_1",
      job: job({ total: 4, sent: 2, nextIndex: 2 }),
      recipients: ["a@x.io", "b@x.io", "c@x.io", "d@x.io"],
      message: "Hello",
      send: async (to) => {
        sent.push(to);
      },
      sleep: async () => undefined,
    });
    expect(sent).toEqual(["c@x.io", "d@x.io"]);
  });

  it("calls a run stalled when it stops writing progress", () => {
    const now = Date.parse("2026-10-11T12:05:00Z");
    expect(jobStalled(job({ updatedAt: "2026-10-11T12:00:00Z" }), now)).toBe(true);
    expect(jobStalled(job({ updatedAt: "2026-10-11T12:04:30Z" }), now)).toBe(false);
    expect(jobStalled(job({ finishedAt: "2026-10-11T12:01:00Z" }), now)).toBe(false);
  });
});

describe("notice copy", () => {
  it("keeps the email body and adds the footer once", () => {
    expect(noticeEmailText("  Hi  ")).toMatch(/^Hi\n\n—\n/);
  });

  it("shortens long banner messages at a word", () => {
    const long = `${"word ".repeat(80)}end`;
    const short = bannerMessage(long);
    expect(short.length).toBeLessThanOrEqual(280);
    expect(short.endsWith("…")).toBe(true);
    expect(bannerMessage(DEFAULT_NOTICE.limited.message)).toBe(DEFAULT_NOTICE.limited.message);
  });
});
