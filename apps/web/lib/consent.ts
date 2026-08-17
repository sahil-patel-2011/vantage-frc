// Forms & consent tracking. FRC teams must collect signed medical releases,
// photo/media consent, travel permission, and code-of-conduct acknowledgements —
// especially before events. This tracks which required forms each participant
// has turned in so the team can chase down what's missing before a trip.

export const FORM_TYPES = [
  "medical_release",
  "photo_consent",
  "code_of_conduct",
  "travel_permission",
  "liability_waiver",
  "emergency_contact",
  "handbook_ack",
  "other",
] as const;
export type FormType = (typeof FORM_TYPES)[number];

export const FORM_TYPE_LABEL: Record<FormType, string> = {
  medical_release: "Medical release",
  photo_consent: "Photo / media consent",
  code_of_conduct: "Code of conduct",
  travel_permission: "Travel permission",
  liability_waiver: "Liability waiver",
  emergency_contact: "Emergency contact",
  handbook_ack: "Handbook acknowledgement",
  other: "Other",
};

export const RECORD_STATUSES = ["pending", "submitted", "verified"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** A record counts as "complete" once it is submitted or verified. */
export function isComplete(status: RecordStatus) {
  return status === "submitted" || status === "verified";
}

export type FormInput = { name: string; formType: FormType; required: boolean; documentUrl: string | null };

export function validateForm(raw: Record<string, unknown>): { ok: true; value: FormInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Form name is required" };
  const formType = String(raw.formType ?? "");
  if (!FORM_TYPES.includes(formType as FormType)) return { ok: false, error: "Invalid form type" };
  const documentUrlRaw = typeof raw.documentUrl === "string" ? raw.documentUrl.trim() : "";
  if (documentUrlRaw) {
    try {
      new URL(documentUrlRaw);
    } catch {
      return { ok: false, error: "Document URL must be a valid URL" };
    }
  }
  return { ok: true, value: { name, formType: formType as FormType, required: raw.required !== false, documentUrl: documentUrlRaw || null } };
}

export function validateRecord(
  raw: Record<string, unknown>,
): { ok: true; value: { formId: string; personName: string; guardianName: string; status: RecordStatus; signedOn: string | null; userId: string | null } } | { ok: false; error: string } {
  const formId = typeof raw.formId === "string" ? raw.formId.trim() : "";
  if (!formId) return { ok: false, error: "Form is required" };
  const personName = typeof raw.personName === "string" ? raw.personName.trim() : "";
  if (!personName) return { ok: false, error: "Person name is required" };
  const status = String(raw.status ?? "submitted");
  if (!RECORD_STATUSES.includes(status as RecordStatus)) return { ok: false, error: "Invalid status" };
  const signedRaw = typeof raw.signedOn === "string" ? raw.signedOn.trim() : "";
  if (signedRaw && Number.isNaN(new Date(signedRaw).getTime())) return { ok: false, error: "Invalid signed date" };
  const userId = typeof raw.userId === "string" && raw.userId.trim() ? raw.userId.trim() : null;
  return {
    ok: true,
    value: {
      formId,
      personName,
      guardianName: typeof raw.guardianName === "string" ? raw.guardianName.trim() : "",
      status: status as RecordStatus,
      signedOn: signedRaw || null,
      userId,
    },
  };
}

export function summarizeConsent(input: {
  forms: { id: string; required: boolean }[];
  records: { formId: string; personName: string; status: RecordStatus }[];
}) {
  const requiredFormIds = new Set(input.forms.filter((f) => f.required).map((f) => f.id));
  const perForm = input.forms.map((form) => {
    const forThis = input.records.filter((r) => r.formId === form.id);
    return {
      formId: form.id,
      submitted: forThis.filter((r) => isComplete(r.status)).length,
      verified: forThis.filter((r) => r.status === "verified").length,
    };
  });

  const people = new Map<string, Set<string>>(); // person -> set of completed form ids
  for (const record of input.records) {
    if (!people.has(record.personName)) people.set(record.personName, new Set());
    if (isComplete(record.status)) people.get(record.personName)!.add(record.formId);
  }
  let fullyComplete = 0;
  for (const completedForms of people.values()) {
    if ([...requiredFormIds].every((id) => completedForms.has(id))) fullyComplete += 1;
  }

  return {
    requiredForms: requiredFormIds.size,
    totalForms: input.forms.length,
    peopleTracked: people.size,
    fullyComplete,
    outstanding: people.size - fullyComplete,
    perForm,
  };
}

/** Which required forms a given person is still missing. */
export function missingFormsFor(
  personName: string,
  forms: { id: string; required: boolean }[],
  records: { formId: string; personName: string; status: RecordStatus }[],
): string[] {
  const done = new Set(records.filter((r) => r.personName === personName && isComplete(r.status)).map((r) => r.formId));
  return forms.filter((f) => f.required && !done.has(f.id)).map((f) => f.id);
}

// ---- request validation --------------------------------------------------

export type ConsentAction =
  | { action: "create_form"; orgId: string; seasonYear: number; name: string; formType: FormType; required: boolean; documentUrl: string | null }
  | { action: "delete_form"; orgId: string; id: string }
  | { action: "add_record"; orgId: string; formId: string; personName: string; guardianName: string; status: RecordStatus; signedOn: string | null; userId: string | null }
  | { action: "set_record_status"; orgId: string; id: string; status: RecordStatus }
  | { action: "delete_record"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseConsentAction(raw: unknown): ConsentAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_form": {
      const validated = validateForm(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "delete_form":
      return { action, orgId, id: reqStr(body.id, "id") };
    case "add_record": {
      const validated = validateRecord(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action, orgId, ...validated.value };
    }
    case "set_record_status": {
      const status = reqStr(body.status, "status");
      if (!RECORD_STATUSES.includes(status as RecordStatus)) throw new Error("Invalid status");
      return { action, orgId, id: reqStr(body.id, "id"), status: status as RecordStatus };
    }
    case "delete_record":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported consent action");
  }
}
