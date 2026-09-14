// FRC Parts relay domain types. Pure data shapes — no I/O, no framework imports.
// A "listing" is a team's own posted need or offer at an event. A "loan" is the actual
// hand-off once two teams match — what went out (lending) or came in (borrowing), and
// whether it has been returned.

export type PartsRelayListingType = "need" | "offer";

export type PartsRelayCategory =
  | "electrical"
  | "mechanical"
  | "pneumatic"
  | "electronics"
  | "fasteners"
  | "battery"
  | "wheels"
  | "other";

export type PartsRelayCondition = "new" | "used" | "any";

export type PartsRelayListingStatus = "open" | "matched" | "fulfilled" | "cancelled";

export type PartsRelayLoanDirection = "lending" | "borrowing";

export type PartsRelayLoanStatus = "active" | "returned" | "overdue" | "lost";

export type PartsRelayListing = {
  id: string;
  listingType: PartsRelayListingType;
  partName: string;
  category: PartsRelayCategory;
  quantity: number;
  condition: PartsRelayCondition;
  eventKey: string | null;
  notes: string | null;
  status: PartsRelayListingStatus;
  createdAt: string;
};

export type PartsRelayLoan = {
  id: string;
  listingId: string | null;
  direction: PartsRelayLoanDirection;
  counterpartyTeam: string;
  partName: string;
  quantity: number;
  eventKey: string | null;
  loanedOn: string;
  dueBackOn: string | null;
  returnedOn: string | null;
  status: PartsRelayLoanStatus;
  notes: string | null;
  createdAt: string;
};

export type PartsRelaySummary = {
  openNeeds: number;
  openOffers: number;
  activeLoans: number;
  overdueLoans: number;
  returnedLoans: number;
  lostLoans: number;
  totalLoans: number;
  lendingCount: number;
  borrowingCount: number;
  /** 0..1 share of completed (returned) loans that came back by their due date. Null when no data. */
  onTimeReturnRate: number | null;
};
