// Scouting schema A/B comparison domain types. Pure data shapes — no I/O, no framework imports.
// Candidates are trial scouting form schemas; samples are real field-completion observations
// logged while a candidate is being trialed (at a scrimmage, practice match, etc). Nothing here
// is fabricated — a candidate with no samples simply has no computed stats.

export type SchemaAbCandidate = {
  id: string;
  label: string;
  fieldCount: number;
  notes: string | null;
  createdAt: string;
};

export type SchemaAbSample = {
  id: string;
  candidateId: string;
  matchNumber: number | null;
  fieldsTotal: number;
  fieldsCompleted: number;
  fillSeconds: number | null;
  hadError: boolean;
  notes: string | null;
  createdAt: string;
};

export type SchemaAbStats = {
  candidateId: string;
  label: string;
  fieldCount: number;
  sampleCount: number;
  /** 0..1 mean fraction of fields completed across samples. */
  avgCompletionRate: number;
  /** 0..1 fraction of samples flagged with an entry error. */
  errorRate: number;
  /** Mean seconds to fill the form, null if never logged. */
  avgFillSeconds: number | null;
  /** 0..1 composite data-quality score blending completion, errors, and speed. */
  qualityScore: number;
};

export type SchemaAbComparison = {
  a: SchemaAbStats;
  b: SchemaAbStats;
  /** Candidate id of the higher qualityScore, or null on an exact tie / insufficient data. */
  winnerId: string | null;
  reasons: string[];
};
