import { describe, expect, it } from "vitest";
import { evaluateIncident, summarizeIncidents } from "./evaluate";
import type { Incident, IncidentCategory, IncidentSeverity, IncidentStatus } from "./types";

let seq = 0;
function incident(overrides: Partial<Incident> = {}): Incident {
  seq += 1;
  return {
    id: `i-${seq}`,
    title: `Incident ${seq}`,
    category: "equipment" as IncidentCategory,
    severity: "moderate" as IncidentSeverity,
    occurredOn: "2026-02-01",
    location: null,
    description: null,
    correctiveAction: null,
    status: "open" as IncidentStatus,
    owner: null,
    dueOn: null,
    notes: null,
    seasonYear: 2026,
    createdAt: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

const ASOF = "2026-02-15";

describe("evaluateIncident", () => {
  it("treats resolved/closed as not open", () => {
    expect(evaluateIncident(incident({ status: "open" }), ASOF).isOpen).toBe(true);
    expect(evaluateIncident(incident({ status: "resolved" }), ASOF).isOpen).toBe(false);
    expect(evaluateIncident(incident({ status: "closed" }), ASOF).isOpen).toBe(false);
  });

  it("flags overdue corrective actions on open incidents only", () => {
    expect(evaluateIncident(incident({ status: "open", dueOn: "2026-02-01" }), ASOF).overdue).toBe(true);
    expect(evaluateIncident(incident({ status: "resolved", dueOn: "2026-02-01" }), ASOF).overdue).toBe(false);
    expect(evaluateIncident(incident({ status: "open", dueOn: "2026-03-01" }), ASOF).overdue).toBe(false);
  });

  it("counts days open from the occurrence date", () => {
    expect(evaluateIncident(incident({ occurredOn: "2026-02-05" }), ASOF).daysOpen).toBe(10);
    expect(evaluateIncident(incident({ status: "closed" }), ASOF).daysOpen).toBeNull();
  });
});

describe("summarizeIncidents", () => {
  it("is all-zero for none", () => {
    const s = summarizeIncidents([], ASOF);
    expect(s.total).toBe(0);
    expect(s.open).toBe(0);
    expect(s.overdue).toEqual([]);
    expect(s.avgDaysOpen).toBe(0);
  });

  it("counts open by severity, excluding resolved from exposure", () => {
    const s = summarizeIncidents(
      [
        incident({ severity: "critical", status: "open" }),
        incident({ severity: "minor", status: "open" }),
        incident({ severity: "critical", status: "closed" }), // excluded
      ],
      ASOF,
    );
    expect(s.open).toBe(2);
    expect(s.bySeverity.critical).toBe(1);
    expect(s.bySeverity.minor).toBe(1);
  });

  it("orders overdue by severity then due date", () => {
    const s = summarizeIncidents(
      [
        incident({ severity: "moderate", status: "open", dueOn: "2026-02-10" }),
        incident({ severity: "critical", status: "open", dueOn: "2026-02-12" }),
        incident({ severity: "minor", status: "open", dueOn: "2026-03-01" }), // not overdue
      ],
      ASOF,
    );
    expect(s.overdue).toHaveLength(2);
    expect(s.overdue[0]?.incident.severity).toBe("critical");
  });

  it("surfaces serious/critical open incidents as priority, newest first", () => {
    const s = summarizeIncidents(
      [
        incident({ severity: "serious", status: "open", occurredOn: "2026-02-01" }),
        incident({ severity: "critical", status: "open", occurredOn: "2026-02-10" }),
        incident({ severity: "minor", status: "open" }), // excluded from priority
      ],
      ASOF,
    );
    expect(s.priority.map((e) => e.incident.severity)).toEqual(["critical", "serious"]);
  });

  it("averages days open across open incidents", () => {
    const s = summarizeIncidents(
      [incident({ occurredOn: "2026-02-05" }), incident({ occurredOn: "2026-02-13" })],
      ASOF,
    );
    expect(s.avgDaysOpen).toBe(6); // (10 + 2) / 2
  });

  it("counts every status", () => {
    const s = summarizeIncidents(
      [incident({ status: "open" }), incident({ status: "investigating" }), incident({ status: "resolved" })],
      ASOF,
    );
    expect(s.byStatus.open).toBe(1);
    expect(s.byStatus.investigating).toBe(1);
    expect(s.byStatus.resolved).toBe(1);
  });
});
