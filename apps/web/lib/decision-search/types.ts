// Decision Search domain types. Pure data shapes — no I/O, no framework imports.
// Semantic search over decisions, design reviews, and notebook entries: the team indexes
// records into decision_search_documents, then runs a query that ranks the indexed documents
// by (grounded, deterministic) relevance to the query text — never a fabricated match.

export type DecisionSearchSourceKind = "decision" | "design_review" | "notebook_entry";

export type DecisionSearchDocument = {
  id: string;
  sourceKind: DecisionSearchSourceKind;
  sourceId: string;
  title: string;
  body: string;
  seasonYear: number;
  tags: string[];
  createdAt: string;
};

export type DecisionSearchMatch = {
  document: DecisionSearchDocument;
  /** 0..1 relevance score, grounded in term overlap between the query and the document. */
  score: number;
  /** Which query terms matched, for transparency in the UI. */
  matchedTerms: string[];
};

export type DecisionSearchQueryRecord = {
  id: string;
  queryText: string;
  resultDocumentIds: string[];
  resultSummary: string | null;
  seasonYear: number;
  createdAt: string;
};
