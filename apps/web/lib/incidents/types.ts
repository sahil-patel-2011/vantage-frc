// Safety Incident Log domain types. Pure data shapes — no I/O, no framework imports.
// People- and shop-safety incidents (injuries, near-misses, equipment/electrical/chemical
// hazards) with a corrective action tracked to closure. Distinct from robot failures/repairs.

export type IncidentCategory =
  | "injury"
  | "near_miss"
  | "equipment"
  | "electrical"
  | "chemical"
  | "property"
  | "other";

export type IncidentSeverity = "minor" | "moderate" | "serious" | "critical";

export type IncidentStatus = "open" | "investigating" | "action_pending" | "resolved" | "closed";

export type Incident = {
  id: string;
  title: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  /** ISO date (YYYY-MM-DD). */
  occurredOn: string;
  location: string | null;
  description: string | null;
  correctiveAction: string | null;
  status: IncidentStatus;
  owner: string | null;
  /** ISO date the corrective action is due, or null. */
  dueOn: string | null;
  notes: string | null;
  seasonYear: number;
  createdAt: string;
};

export type IncidentEvaluation = {
  incident: Incident;
  /** Not yet resolved/closed. */
  isOpen: boolean;
  /** Corrective action past its due date and still open. */
  overdue: boolean;
  daysToDue: number | null;
  /** Days since it occurred (open incidents only; null otherwise). */
  daysOpen: number | null;
};

export type IncidentsSummary = {
  total: number;
  open: number;
  /** Counts over OPEN incidents — current exposure. */
  bySeverity: Record<IncidentSeverity, number>;
  byStatus: Record<IncidentStatus, number>;
  byCategory: Array<{ category: IncidentCategory; open: number }>;
  /** Open incidents whose corrective action is overdue, most severe first. */
  overdue: IncidentEvaluation[];
  /** Open serious/critical incidents, most recent first. */
  priority: IncidentEvaluation[];
  avgDaysOpen: number;
};
