import { describe, expect, it } from "vitest";
import { missingFormsFor, parseConsentAction, summarizeConsent, validateForm, validateRecord } from "./consent";

describe("validateForm", () => {
  it("requires a name and valid type", () => {
    expect(validateForm({ formType: "medical_release" }).ok).toBe(false);
    expect(validateForm({ name: "Release", formType: "nope" }).ok).toBe(false);
  });
  it("rejects a bad document URL", () => {
    expect(validateForm({ name: "Release", formType: "medical_release", documentUrl: "not-url" }).ok).toBe(false);
  });
  it("defaults required to true", () => {
    const result = validateForm({ name: "Release", formType: "medical_release" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.required).toBe(true);
  });
});

describe("validateRecord", () => {
  it("requires form and person", () => {
    expect(validateRecord({ personName: "Sam" }).ok).toBe(false);
    expect(validateRecord({ formId: "f1" }).ok).toBe(false);
  });
  it("defaults status to submitted", () => {
    const result = validateRecord({ formId: "f1", personName: "Sam" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("submitted");
      expect(result.value.userId).toBeNull();
    }
  });
  it("keeps an optional membership user id", () => {
    const result = validateRecord({ formId: "f1", personName: "Sam", userId: "u-9" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.userId).toBe("u-9");
  });
});

describe("summarizeConsent", () => {
  const forms = [
    { id: "med", required: true },
    { id: "photo", required: true },
    { id: "extra", required: false },
  ];
  it("counts fully-complete vs outstanding people against required forms", () => {
    const summary = summarizeConsent({
      forms,
      records: [
        { formId: "med", personName: "Sam", status: "verified" },
        { formId: "photo", personName: "Sam", status: "submitted" },
        { formId: "med", personName: "Alex", status: "submitted" },
        { formId: "photo", personName: "Alex", status: "pending" },
      ],
    });
    expect(summary.requiredForms).toBe(2);
    expect(summary.peopleTracked).toBe(2);
    expect(summary.fullyComplete).toBe(1); // Sam has both required; Alex's photo is pending
    expect(summary.outstanding).toBe(1);
    expect(summary.perForm.find((p) => p.formId === "med")?.submitted).toBe(2);
    expect(summary.perForm.find((p) => p.formId === "photo")?.verified).toBe(0);
  });
});

describe("missingFormsFor", () => {
  const forms = [
    { id: "med", required: true },
    { id: "photo", required: true },
    { id: "extra", required: false },
  ];
  it("lists only required forms the person has not completed", () => {
    const missing = missingFormsFor("Alex", forms, [
      { formId: "med", personName: "Alex", status: "submitted" },
      { formId: "photo", personName: "Alex", status: "pending" },
    ]);
    expect(missing).toEqual(["photo"]);
  });
});

describe("parseConsentAction", () => {
  it("parses create_form with season year", () => {
    const action = parseConsentAction({ action: "create_form", orgId: "o1", seasonYear: 2026, name: "Release", formType: "medical_release" });
    expect(action).toMatchObject({ action: "create_form", formType: "medical_release", required: true });
  });
  it("rejects create_form without season year", () => {
    expect(() => parseConsentAction({ action: "create_form", orgId: "o1", name: "x", formType: "other" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseConsentAction({ action: "shred", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
