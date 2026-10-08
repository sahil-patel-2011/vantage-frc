export type AssignmentReceipt = {
  action: string;
  eventKey: string;
  assigned: number;
  unchanged: number;
  refused: string[];
};

export function isAssignmentReceipt(value: unknown): value is AssignmentReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as AssignmentReceipt;
  return typeof receipt.action === "string" && typeof receipt.eventKey === "string" &&
    Number.isSafeInteger(receipt.assigned) && receipt.assigned >= 0 && Number.isSafeInteger(receipt.unchanged) && receipt.unchanged >= 0 &&
    Array.isArray(receipt.refused) && receipt.refused.every(reason => typeof reason === "string");
}

export function assignmentReceiptMessage(receipt: AssignmentReceipt): string {
  const parts = [`${receipt.assigned} ${receipt.assigned === 1 ? "assignment" : "assignments"} saved.`];
  if (receipt.unchanged) parts.push(`${receipt.unchanged} already assigned.`);
  if (receipt.refused.length) parts.push(`${receipt.refused.length} could not be assigned. Review the reasons below.`);
  else if (!receipt.assigned && !receipt.unchanged) parts.push("No additional assignments were created. Review uncovered robots and scout availability.");
  return parts.join(" ");
}
