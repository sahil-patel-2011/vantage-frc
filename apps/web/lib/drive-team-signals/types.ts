// Drive-team signal board domain types. Pure data shapes — no I/O, no framework imports.
// A "sheet" is a standardized cheat-sheet of driver/human-player comms signals for a game
// (hand signals, verbal callouts, radio codes, field markers) so the whole drive team agrees
// on the same vocabulary before matches.

export type SignalKind = "hand_signal" | "verbal_callout" | "radio_code" | "field_marker" | "other";

export type SignalPriority = "critical" | "important" | "fyi";

/** Who is expected to call/give this signal on the field. */
export type SignalRole = "driver" | "human_player" | "coach" | "scout" | "other";

export type DriveTeamSignal = {
  id: string;
  kind: SignalKind;
  /** Short code/gesture name, e.g. "Fist pump" or "Cage!" */
  code: string;
  /** What it means / what to do when it's seen or heard. */
  meaning: string;
  calledBy: SignalRole;
  priority: SignalPriority;
};

export type DriveTeamSignalSheet = {
  id: string;
  title: string;
  gameYear: number;
  eventKey: string | null;
  signals: DriveTeamSignal[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DriveTeamSignalsSummary = {
  totalSheets: number;
  totalSignals: number;
  criticalSignals: number;
  byKind: Array<{ kind: SignalKind; count: number }>;
  byPriority: Array<{ priority: SignalPriority; count: number }>;
};
