import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeCrossDomainAlertsView } from "./compute-cross-domain-alerts";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeCrossDomainAlertsView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeCrossDomainAlertsView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("flags a CAD change overlapping an open design review and a firmware version mismatch", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM cross_domain_alerts_subsystem_events") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "event-1",
              subsystem: "Intake",
              domain: "cad",
              title: "Reworked intake roller mount",
              description: null,
              source: "manual",
              sourceRef: null,
              occurredAt: "2026-02-01T00:00:00.000Z",
              seasonYear: 2026,
            },
          ],
        };
      }
      if (sql.includes("FROM design_reviews")) {
        return {
          rows: [
            {
              id: "review-1",
              title: "Intake critical design review",
              subsystem: "intake",
              stage: "critical",
              status: "in_review",
              scheduledOn: "2026-02-05",
            },
          ],
        };
      }
      if (sql.includes("FROM software_versions")) {
        return {
          rows: [
            {
              id: "version-1",
              component: "roboRIO image",
              category: "firmware",
              installedVersion: "2025.1.1",
              targetVersion: "2026.1.0",
            },
          ],
        };
      }
      if (sql.includes("FROM cross_domain_alerts_acks")) {
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeCrossDomainAlertsView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.alerts).toHaveLength(2);
    expect(view.summary.reviewConflictCount).toBe(1);
    expect(view.summary.versionMismatchCount).toBe(1);
    expect(view.summary.criticalCount).toBe(1);
    const conflict = view.alerts.find((a) => a.kind === "cad_review_conflict");
    expect(conflict?.subsystem).toBe("Intake");
    expect(conflict?.relatedReviewId).toBe("review-1");
    const mismatch = view.alerts.find((a) => a.kind === "version_mismatch");
    expect(mismatch?.title).toContain("2025.1.1");
    expect(mismatch?.title).toContain("2026.1.0");
  });

  it("suppresses an alert whose key has been acknowledged", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM cross_domain_alerts_subsystem_events") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "event-1",
              subsystem: "Intake",
              domain: "cad",
              title: "Reworked intake roller mount",
              description: null,
              source: "manual",
              sourceRef: null,
              occurredAt: "2026-02-01T00:00:00.000Z",
              seasonYear: 2026,
            },
          ],
        };
      }
      if (sql.includes("FROM design_reviews")) {
        return {
          rows: [
            {
              id: "review-1",
              title: "Intake critical design review",
              subsystem: "intake",
              stage: "critical",
              status: "in_review",
              scheduledOn: "2026-02-05",
            },
          ],
        };
      }
      if (sql.includes("FROM software_versions")) {
        return { rows: [] };
      }
      if (sql.includes("FROM cross_domain_alerts_acks")) {
        // Acknowledge the exact review-conflict key produced for event-1/review-1.
        return { rows: [{ alertKey: "cad_review_conflict:event-1:review-1" }] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeCrossDomainAlertsView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    // The one candidate alert is acknowledged, so it must not surface.
    expect(view.alerts).toHaveLength(0);
    expect(view.summary.reviewConflictCount).toBe(0);
    // The underlying logged event is still returned for context.
    expect(view.events).toHaveLength(1);
  });
});
