import { describe, expect, it } from "vitest";
import { bulletList, captureSlug, captureTitle, cleanText, renderCaptureBody, uniqueSlug } from "./format";
import { MAX_SLUG } from "../knowledge/types";

describe("cleanText", () => {
  it("returns null for anything that is not recorded prose", () => {
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText("   \n ")).toBeNull();
    expect(cleanText(42)).toBeNull();
    expect(cleanText("  kept  ")).toBe("kept");
  });
});

describe("renderCaptureBody", () => {
  it("omits sections with no recorded text instead of writing a placeholder", () => {
    const body = renderCaptureBody({
      title: "Decision — swerve",
      facts: [
        { label: "Category", value: "design" },
        { label: "Deciders", value: "   " },
      ],
      sections: [
        { heading: "Context", text: "Tank drive lost cycles." },
        { heading: "Why", text: null },
      ],
      provenance: "Drafted from the decision log.",
    });

    expect(body).toContain("## Context");
    expect(body).toContain("Tank drive lost cycles.");
    expect(body).toContain("**Category:** design");
    // The blank rationale leaves no trace at all — no heading, no dash, no "TBD".
    expect(body).not.toContain("## Why");
    expect(body).not.toContain("Deciders");
    expect(body).not.toMatch(/^-$/m);
    expect(body).not.toMatch(/TBD|N\/A|placeholder/i);
  });

  it("contains only the heading text and the source text it was given", () => {
    const body = renderCaptureBody({
      title: "T",
      facts: [],
      sections: [{ heading: "Context", text: "alpha bravo" }],
      provenance: "P",
    });
    expect(body).toBe("# T\n\n## Context\nalpha bravo\n\n---\nP\n");
  });

  it("caps the body at the knowledge_pages length limit", () => {
    const body = renderCaptureBody({
      title: "Long",
      facts: [],
      sections: [{ heading: "Context", text: "x".repeat(80000) }],
      provenance: "P",
    });
    expect(body.length).toBeLessThanOrEqual(50000);
  });
});

describe("captureTitle", () => {
  it("collapses whitespace and respects the 200-char title limit", () => {
    expect(captureTitle("  a   b  ")).toBe("a b");
    expect(captureTitle("z".repeat(400))).toHaveLength(200);
  });
});

describe("captureSlug", () => {
  it("produces a slug in the knowledge_pages grammar", () => {
    const slug = captureSlug("decision", "Swerve vs. tank — 2026!", "3f1c9a20-1111-2222-3333-444455556666");
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slug.startsWith("decision-swerve-vs-tank-2026-")).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG);
  });

  it("keeps the source id suffix so two long, similar titles stay distinct", () => {
    const long = "A very long decision title that keeps going and going and going and going";
    const a = captureSlug("decision", long, "aaaaaaaa-0000-0000-0000-000000000000");
    const b = captureSlug("decision", long, "bbbbbbbb-0000-0000-0000-000000000000");
    expect(a).not.toBe(b);
  });
});

describe("uniqueSlug", () => {
  it("returns the desired slug when free", () => {
    expect(uniqueSlug("decision-swerve", ["other"])).toBe("decision-swerve");
  });

  it("suffixes past collisions", () => {
    expect(uniqueSlug("decision-swerve", ["decision-swerve"])).toBe("decision-swerve-2");
    expect(uniqueSlug("decision-swerve", ["decision-swerve", "decision-swerve-2"])).toBe(
      "decision-swerve-3",
    );
  });

  it("stays inside MAX_SLUG when suffixing a maximal slug", () => {
    const base = "a".repeat(MAX_SLUG);
    const out = uniqueSlug(base, [base]);
    expect(out.length).toBeLessThanOrEqual(MAX_SLUG);
    expect(out).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("bulletList", () => {
  it("drops blanks and returns null when nothing survives", () => {
    expect(bulletList(["a", "  ", "b"])).toBe("- a\n- b");
    expect(bulletList([null, "   "])).toBeNull();
  });
});
