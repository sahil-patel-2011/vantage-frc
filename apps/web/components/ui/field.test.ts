/**
 * Contract tests for the shared form field primitives (field.tsx).
 *
 * No jsdom/@testing-library is installed (vitest.config.ts runs `environment: "node"`
 * against `**\/*.test.ts`), so these render each field to a static HTML string with
 * `react-dom/server` and assert on the markup directly — label/id association,
 * aria-invalid, and aria-describedby are all plain attributes on that string, and
 * this needs no browser DOM to verify.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CheckboxField,
  FieldError,
  FieldHelp,
  FileField,
  RadioGroup,
  SelectField,
  TextareaField,
  TextField,
} from "./field";

function html(element: Parameters<typeof createElement>[0], props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(element, props));
}

function labelFor(markup: string): string | undefined {
  return /<label[^>]*\sfor="([^"]+)"/.exec(markup)?.[1];
}

function inputId(markup: string, tag = "input"): string | undefined {
  return new RegExp(`<${tag}[^>]*\\sid="([^"]+)"`).exec(markup)?.[1];
}

function describedBy(markup: string): string[] {
  const value = /aria-describedby="([^"]+)"/.exec(markup)?.[1];
  return value ? value.split(" ") : [];
}

describe("TextField", () => {
  it("associates the visible label with the input via matching for/id", () => {
    const markup = html(TextField, { label: "Team number", value: "118", onChange: () => {} });
    const forId = labelFor(markup);
    expect(forId).toBeTruthy();
    expect(inputId(markup)).toBe(forId);
    expect(markup).toContain("Team number");
  });

  it("has no aria-invalid or aria-describedby when there is nothing to report", () => {
    const markup = html(TextField, { label: "Name", value: "", onChange: () => {} });
    expect(markup).not.toContain("aria-invalid");
    expect(markup).not.toContain("aria-describedby");
  });

  it("sets aria-invalid and points aria-describedby at a real, rendered error node", () => {
    const markup = html(TextField, { label: "Name", error: "Name is required", value: "", onChange: () => {} });
    expect(markup).toContain('aria-invalid="true"');
    const ids = describedBy(markup);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Name is required");
  });

  it("wires help text into aria-describedby without marking the field invalid", () => {
    const markup = html(TextField, { label: "Name", help: "As it appears on your roster", value: "", onChange: () => {} });
    expect(markup).not.toContain("aria-invalid");
    const ids = describedBy(markup);
    expect(ids.length).toBe(1);
    expect(markup).toContain(`id="${ids[0]}"`);
    expect(markup).toContain("As it appears on your roster");
  });

  it("includes both help and error ids in aria-describedby when both are present", () => {
    const markup = html(TextField, {
      label: "Name",
      help: "As it appears on your roster",
      error: "Required",
      value: "",
      onChange: () => {},
    });
    const ids = describedBy(markup);
    expect(ids.length).toBe(2);
  });

  it("disables the control while loading, and still renders the label text", () => {
    const markup = html(TextField, { label: "Name", loading: true, value: "", onChange: () => {} });
    expect(markup).toMatch(/<input[^>]*\bdisabled\b/);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Name");
  });

  it("marks a required field for assistive tech and keeps a visible asterisk", () => {
    const markup = html(TextField, { label: "Name", required: true, value: "", onChange: () => {} });
    expect(markup).toMatch(/<input[^>]*\brequired\b/);
  });

  it("passes an explicit id straight through instead of generating one", () => {
    const markup = html(TextField, { label: "Name", id: "team-name", value: "", onChange: () => {} });
    expect(labelFor(markup)).toBe("team-name");
    expect(inputId(markup)).toBe("team-name");
  });
});

describe("TextareaField", () => {
  it("associates its label and wires an error the same way TextField does", () => {
    const markup = html(TextareaField, { label: "Notes", error: "Too long", value: "", onChange: () => {} });
    const forId = labelFor(markup);
    expect(inputId(markup, "textarea")).toBe(forId);
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("Too long");
  });
});

describe("SelectField", () => {
  it("renders a disabled placeholder option plus the real options", () => {
    const markup = html(SelectField, {
      label: "Category",
      placeholder: "Choose one",
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      value: "",
      onChange: () => {},
    });
    expect(markup).toMatch(/<option[^>]*value=""[^>]*disabled/);
    expect(markup).toContain("Choose one");
    expect(markup).toContain("Alpha");
    expect(markup).toContain("Beta");
  });

  it("associates the label with the select and reports invalid state", () => {
    const markup = html(SelectField, {
      label: "Category",
      error: "Pick one",
      options: [{ value: "a", label: "Alpha" }],
      value: "",
      onChange: () => {},
    });
    const forId = labelFor(markup);
    expect(inputId(markup, "select")).toBe(forId);
    expect(markup).toContain('aria-invalid="true"');
  });
});

describe("CheckboxField", () => {
  it("wraps the input and label in one <label> so the whole row is the hit target", () => {
    const markup = html(CheckboxField, { label: "Send email updates", checked: false, onChange: () => {} });
    const forId = labelFor(markup);
    expect(forId).toBeTruthy();
    expect(inputId(markup)).toBe(forId);
    expect(markup).toMatch(/<input[^>]*type="checkbox"/);
    expect(markup).toContain("Send email updates");
  });

  it("reports an error through aria-invalid/aria-describedby on the checkbox itself", () => {
    const markup = html(CheckboxField, { label: "Accept terms", error: "Required", checked: false, onChange: () => {} });
    expect(markup).toContain('aria-invalid="true"');
    const ids = describedBy(markup);
    expect(ids.length).toBe(1);
    expect(markup).toContain(`id="${ids[0]}"`);
  });
});

describe("RadioGroup", () => {
  it("renders a fieldset/legend so the group name is announced once, and checks the matching option", () => {
    const markup = html(RadioGroup, {
      legend: "Unit",
      name: "unit",
      value: "each",
      onChange: () => {},
      options: [
        { value: "each", label: "Each" },
        { value: "lb", label: "Pounds" },
      ],
    });
    expect(markup).toMatch(/<fieldset/);
    expect(markup).toContain("<legend");
    expect(markup).toContain("Unit");
    // Exactly one radio carries checked="" (React SSR's boolean-attribute form).
    const checkedCount = markup.match(/type="radio"[^>]*checked=""/g)?.length ?? 0;
    expect(checkedCount).toBe(1);
    expect(markup).toContain('value="each"');
  });

  it("gives every option a distinct id scoped off the group, and shares the group's name attribute", () => {
    const markup = html(RadioGroup, {
      legend: "Unit",
      name: "unit",
      value: null,
      onChange: () => {},
      options: [
        { value: "each", label: "Each" },
        { value: "lb", label: "Pounds" },
      ],
    });
    const ids = [...markup.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const names = [...markup.matchAll(/\sname="([^"]+)"/g)].map((m) => m[1]);
    expect(names.every((n) => n === "unit")).toBe(true);
  });

  it("disables every option and reports aria-busy while loading", () => {
    const markup = html(RadioGroup, {
      legend: "Unit",
      name: "unit",
      value: null,
      onChange: () => {},
      loading: true,
      options: [{ value: "each", label: "Each" }],
    });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/<fieldset[^>]*\bdisabled\b/);
  });
});

describe("FileField", () => {
  it("renders a real file input associated with its label", () => {
    const markup = html(FileField, { label: "Upload photo", onChange: () => {} });
    const forId = labelFor(markup);
    expect(inputId(markup)).toBe(forId);
    expect(markup).toMatch(/<input[^>]*type="file"/);
  });
});

describe("FieldHelp / FieldError", () => {
  it("render nothing for empty/undefined content, so callers never get a stray empty <p>", () => {
    expect(html(FieldHelp, { children: undefined })).toBe("");
    expect(html(FieldHelp, { children: "" })).toBe("");
    expect(html(FieldError, { children: undefined })).toBe("");
    expect(html(FieldError, { children: "" })).toBe("");
  });

  it("FieldError announces via role=alert; FieldHelp does not", () => {
    expect(html(FieldError, { children: "Oops" })).toContain('role="alert"');
    expect(html(FieldHelp, { children: "Hint" })).not.toContain("role=");
  });
});
