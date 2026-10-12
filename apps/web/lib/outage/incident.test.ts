import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAUSE_CHANGE_MIN_MS,
  REALERT_AFTER_RECOVERY_MS,
  REMINDER_MS,
  REOPEN_WINDOW_MS,
  createOutageReporter,
  formatDuration,
  readIncident,
  type OwnerMail,
  type ReporterDeps,
} from "./incident";
import { NOTICE_KEY } from "./notice";
import { MemoryOutageStore } from "./status-store";

const refused = () => Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:5432"), { code: "ECONNREFUSED" });
const timedOut = () => Object.assign(new Error("connect ETIMEDOUT 203.0.113.9:5432"), { code: "ETIMEDOUT" });

const MINUTE = 60_000;

function harness(overrides: Partial<ReporterDeps> = {}) {
  let clock = Date.parse("2026-10-11T12:00:00Z");
  let ids = 0;
  const store = new MemoryOutageStore(() => clock);
  const mails: OwnerMail[] = [];
  const log = { warn: vi.fn(), error: vi.fn() };
  const deps: ReporterDeps = {
    store,
    sendOwnerEmail: async (mail) => {
      mails.push(mail);
    },
    ownerEmail: () => "owner@example.com",
    consoleUrl: (id) => `https://vantage.test/status/outage?t=token-for-${id}`,
    now: () => clock,
    newId: () => `incident_${++ids}`,
    log,
    ...overrides,
  };
  const reporter = createOutageReporter(deps);
  return {
    store,
    mails,
    log,
    reporter,
    deps,
    advance(ms: number) {
      clock += ms;
    },
    another: () => createOutageReporter(deps),
  };
}

describe("outage incident reporting", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("keeps the alert record when several first failures arrive at once, so recovery still emails", async () => {
    const [a, b, c] = [h.another(), h.another(), h.another()];
    await Promise.all([a.reportFailure(refused(), "proxy"), b.reportFailure(refused(), "api/me"), c.reportFailure(refused(), "api/health")]);
    expect(h.mails).toHaveLength(1);
    const incident = await readIncident(h.store);
    expect(incident?.alerts).toMatchObject({ sent: 1, ownerKnowsDown: true, delivered: 1 });
    h.advance(5 * MINUTE);
    await h.reporter.reportHealthy("api/health");
    expect(h.mails).toHaveLength(2);
    expect(h.mails[1]!.subject).toMatch(/^Vantage is back/);
  });

  it("calls a retried first alert the first one, not 'again'", async () => {
    let fail = true;
    const flaky = harness({
      sendOwnerEmail: async (mail) => {
        if (fail) throw new Error("rate limited");
        flaky.mails.push(mail);
      },
    });
    await flaky.reporter.reportFailure(refused(), "api/health");
    expect(flaky.mails).toHaveLength(0);
    fail = false;
    flaky.advance(6 * MINUTE);
    await flaky.reporter.reportFailure(refused(), "api/health");
    expect(flaky.mails).toHaveLength(1);
    expect(flaky.mails[0]!.subject).toBe("Vantage: the NAS database is unreachable — Postgres isn't accepting connections");
  });

  it("emails the owner once on the first failure, with what/why/fix and the console link", async () => {
    await h.reporter.reportFailure(refused(), "api/health");
    expect(h.mails).toHaveLength(1);
    const mail = h.mails[0]!;
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toBe("Vantage: the NAS database is unreachable — Postgres isn't accepting connections");
    expect(mail.text).toMatch(/What failed: Postgres isn't accepting connections \(ECONNREFUSED/);
    expect(mail.text).toMatch(/Why: The NAS is reachable/);
    expect(mail.text).toMatch(/What to try: Open the NAS's container app/);
    expect(mail.text).toMatch(/First seen: Oct 11, 2026/);
    expect(mail.text).toMatch(/Scouting keeps saving on phones/);
    expect(mail.text).toMatch(/spreadsheet copy/);
    expect(mail.text).toContain("https://vantage.test/status/outage?t=token-for-incident_1");
    expect(mail.text).toMatch(/only to you/);

    const incident = await readIncident(h.store);
    expect(incident).toMatchObject({ id: "incident_1", closedAt: null, failures: 1, sources: ["api/health"] });
    expect(incident!.alerts).toMatchObject({ sent: 1, ownerKnowsDown: true });
  });

  it("does not email again for repeat failures with the same cause", async () => {
    await h.reporter.reportFailure(refused(), "api/health");
    // A burst inside one instance folds into a single write.
    await h.reporter.reportFailure(refused(), "api/me");
    await h.reporter.reportFailure(refused(), "api/me");
    h.advance(5 * MINUTE);
    await h.reporter.reportFailure(refused(), "api/health");
    h.advance(60 * MINUTE);
    await h.reporter.reportFailure(refused(), "api/me");
    expect(h.mails).toHaveLength(1);
    const incident = await readIncident(h.store);
    expect(incident!.failures).toBe(5);
    expect(incident!.sources.sort()).toEqual(["api/health", "api/me"]);
  });

  it("concurrent first failures on two servers send one email and agree on one incident", async () => {
    const other = h.another();
    await Promise.all([h.reporter.reportFailure(refused(), "api/health"), other.reportFailure(refused(), "api/me")]);
    expect(h.mails).toHaveLength(1);
    expect((await readIncident(h.store))!.id).toBe("incident_1");
  });

  it("re-emails when the cause changes, once per cause and not within 10 minutes", async () => {
    await h.reporter.reportFailure(timedOut(), "api/health");
    h.advance(CAUSE_CHANGE_MIN_MS - MINUTE);
    await h.reporter.reportFailure(refused(), "api/health");
    expect(h.mails).toHaveLength(1);
    h.advance(2 * MINUTE);
    await h.reporter.reportFailure(refused(), "api/health");
    expect(h.mails).toHaveLength(2);
    expect(h.mails[1]!.subject).toBe("Vantage: the NAS database is still down — now: Postgres isn't accepting connections");
    // Flipping back to a cause already emailed doesn't email again.
    h.advance(20 * MINUTE);
    await h.reporter.reportFailure(timedOut(), "api/health");
    h.advance(20 * MINUTE);
    await h.reporter.reportFailure(refused(), "api/health");
    expect(h.mails).toHaveLength(2);
  });

  it("reminds every 6 hours while the incident stays open", async () => {
    await h.reporter.reportFailure(refused(), "api/health");
    h.advance(REMINDER_MS - MINUTE);
    await h.reporter.reportFailure(refused(), "api/health");
    expect(h.mails).toHaveLength(1);
    h.advance(2 * MINUTE);
    await h.reporter.reportFailure(refused(), "api/health");
    expect(h.mails).toHaveLength(2);
    expect(h.mails[1]!.subject).toMatch(/still unreachable \(6 h 1 min\)/);
  });

  it("emails once when the database answers again, with the outage duration", async () => {
    await h.reporter.reportFailure(refused(), "api/health");
    h.advance(83 * MINUTE);
    await Promise.all([h.reporter.reportHealthy("api/health"), h.another().reportHealthy("api/health")]);
    await h.reporter.reportHealthy("api/health");
    expect(h.mails).toHaveLength(2);
    expect(h.mails[1]!.subject).toBe("Vantage is back — the database answered again after 1 h 23 min");
    expect(h.mails[1]!.text).toMatch(/Down for: 1 h 23 min/);
    expect((await readIncident(h.store))!.closedAt).not.toBeNull();
    // Healthy with nothing open: no mail.
    h.advance(MINUTE);
    await h.another().reportHealthy("api/health");
    expect(h.mails).toHaveLength(2);
  });

  it("the back email says when the limited banner is still on", async () => {
    await h.reporter.reportFailure(refused(), "api/health");
    await h.store.set(NOTICE_KEY, JSON.stringify({ limited: true, message: "x", since: "now", incidentId: "incident_1" }));
    h.advance(10 * MINUTE);
    await h.reporter.reportHealthy("api/health");
    expect(h.mails[1]!.text).toMatch(/banner is still showing/);
  });

  it("healthy checks with no incident never email", async () => {
    await h.reporter.reportHealthy("api/health");
    expect(h.mails).toHaveLength(0);
    expect(await readIncident(h.store)).toBeNull();
  });

  it("a failure soon after recovery reopens the same incident and, after a pause, says it is down again", async () => {
    await h.reporter.reportFailure(refused(), "api/health");
    h.advance(4 * MINUTE);
    await h.reporter.reportHealthy("api/health");
    expect(h.mails).toHaveLength(2);
    h.advance(2 * MINUTE);
    await h.reporter.reportFailure(refused(), "api/health");
    // Flapping: no third email straight away…
    expect(h.mails).toHaveLength(2);
    const reopened = await readIncident(h.store);
    expect(reopened).toMatchObject({ id: "incident_1", closedAt: null });
    // …but if it stays down, the owner is told again.
    h.advance(REALERT_AFTER_RECOVERY_MS);
    await h.reporter.reportFailure(refused(), "api/health");
    expect(h.mails).toHaveLength(3);
    expect(h.mails[2]!.subject).toMatch(/unreachable again/);
  });

  it("a failure long after recovery opens a new incident with its own first email", async () => {
    await h.reporter.reportFailure(refused(), "api/health");
    h.advance(MINUTE);
    await h.reporter.reportHealthy("api/health");
    h.advance(REOPEN_WINDOW_MS + MINUTE);
    await h.reporter.reportFailure(timedOut(), "api/health");
    expect(h.mails).toHaveLength(3);
    expect((await readIncident(h.store))!.id).toBe("incident_2");
    expect(h.mails[2]!.subject).toBe("Vantage: the NAS database is unreachable — The NAS can't be reached");
  });

  it("without PLATFORM_OWNER_EMAIL it logs the missing variable and emails nobody", async () => {
    const send = vi.fn();
    const quiet = harness({ ownerEmail: () => null, sendOwnerEmail: send });
    await quiet.reporter.reportFailure(refused(), "api/health");
    expect(send).not.toHaveBeenCalled();
    expect(quiet.log.warn).toHaveBeenCalledWith(expect.stringContaining("PLATFORM_OWNER_EMAIL"));
    expect((await readIncident(quiet.store))!.failures).toBe(1);
  });

  it("never throws, and a failed send is retried a few minutes later", async () => {
    let fail = true;
    const flaky = harness({
      sendOwnerEmail: async () => {
        if (fail) throw new Error("Email provider returned 500");
      },
    });
    await expect(flaky.reporter.reportFailure(refused(), "api/health")).resolves.toBeUndefined();
    expect(flaky.log.error).toHaveBeenCalledWith(expect.stringContaining("Could not email the owner"));
    fail = false;
    flaky.advance(6 * MINUTE);
    const spy = vi.spyOn(flaky.deps, "sendOwnerEmail");
    await flaky.reporter.reportFailure(refused(), "api/health");
    expect(spy).toHaveBeenCalledTimes(1);

    const broken = harness({
      store: {
        kind: "memory",
        get: async () => {
          throw new Error("store down");
        },
        set: async () => {
          throw new Error("store down");
        },
        delete: async () => undefined,
      },
    });
    await expect(broken.reporter.reportFailure(refused(), "api/health")).resolves.toBeUndefined();
    await expect(broken.reporter.reportHealthy("api/health")).resolves.toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("reads like a person wrote it", () => {
    expect(formatDuration(20_000)).toBe("under a minute");
    expect(formatDuration(45 * MINUTE)).toBe("45 min");
    expect(formatDuration(120 * MINUTE)).toBe("2 h");
    expect(formatDuration(27 * 60 * MINUTE)).toBe("1 d 3 h");
  });
});
