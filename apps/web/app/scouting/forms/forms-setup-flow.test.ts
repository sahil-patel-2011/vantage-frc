import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDraftPublishStatus } from "../../../lib/scouting/form-builder";
import { defaultQuestions, formStatusLine, initialFormType } from "./forms-model";

/*
  UX-5: "Set up scouting" on a phone opened the pit form, said the form's status three times,
  had a "Ready to publish" card with no button, and its publish bar covered question 13.
*/

const unpublished = resolveDraftPublishStatus({ published: null, draftTitle: "Match scouting", draftQuestions: defaultQuestions("match") });
const published = resolveDraftPublishStatus({
  published: { version: 1, definition: { title: "Match scouting", fields: [] } },
  draftTitle: "Match scouting",
  draftQuestions: [],
});
const base = { status: unpublished, canManage: true, publishBlocked: false, justPublished: false, draft: "saved" as const };

describe("the form builder opens the match form first", () => {
  it("opens match unless the pit form is asked for", () => {
    expect(initialFormType(null)).toBe("match");
    expect(initialFormType("")).toBe("match");
    expect(initialFormType("match")).toBe("match");
    expect(initialFormType("nonsense")).toBe("match");
    expect(initialFormType("pit")).toBe("pit");
  });

  it("starts the editor on the match form's own title and questions", () => {
    const src = readFileSync(join(__dirname, "forms-client.tsx"), "utf8");
    expect(src).toMatch(/useState<EntryType>\(\(\) => initialFormType\(searchParams\.get\("type"\)\)\)/);
    expect(src).not.toMatch(/useState<EntryType>\("pit"\)/);
    expect(src).not.toMatch(/useState\(\(\) => defaultQuestions\("pit"\)\)/);
  });
});

describe("one status line, beside the one publish button", () => {
  it("says Ready to publish, with the device draft, while nothing blocks publishing", () => {
    expect(formStatusLine(base)).toEqual({
      label: "Ready to publish",
      detail: "Draft saved on this device.",
      tone: "ready",
    });
    // A fresh form, with nothing edited yet, gets the starting hint instead.
    expect(formStatusLine({ ...base, draft: null }).detail).toBe("Start with these questions or tailor them below.");
    expect(formStatusLine({ ...base, draft: "unsaved" }).detail).toMatch(/Draft not saved — keep this editor open\.$/);
  });

  it("falls back to the draft state when publishing is blocked", () => {
    const line = formStatusLine({ ...base, publishBlocked: true });
    expect(line.label).toBe("Draft — not published");
    expect(line.tone).toBe("draft");
  });

  it("confirms a publish in the same place", () => {
    expect(formStatusLine({ ...base, status: published, justPublished: true, draft: null })).toEqual({
      label: "Published v1",
      detail: "Scouts see this form the next time they open Scout.",
      tone: "published",
    });
  });

  it("tells someone who cannot publish that there is no form yet, without draft talk", () => {
    const line = formStatusLine({ ...base, canManage: false, draft: "saving" });
    expect(line.label).toBe("No published form yet");
    expect(line.detail).not.toMatch(/draft/i);
  });

  it("renders the status once: no separate Ready card and no second status above the questions", () => {
    const src = readFileSync(join(__dirname, "forms-client.tsx"), "utf8");
    expect(src.match(/className="sfb-action-status"/g)).toHaveLength(1);
    expect(src).not.toMatch(/sfb-document-state/);
    expect(src).not.toMatch(/sfb-shell-empty/);
    expect(src).not.toMatch(/className="sfb-published-card"/);
    expect(src).toMatch(/<strong>\{statusLine\.label\}<\/strong>/);
  });
});

describe("the phone publish bar covers nothing", () => {
  const css = readFileSync(join(__dirname, "forms.css"), "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 720px)"));

  it("is fixed to the screen, not to an animated ancestor", () => {
    expect(phone).toMatch(/\.sfb-document-actions \{ position: fixed;/);
    expect(phone).toMatch(/\.module-page:has\(\.sfb-document-actions\) \{ animation: none; transform: none; \}/);
  });

  it("ends the form one measured bar height, safe-area aware, above the bottom", () => {
    expect(phone).toMatch(/\.sfb-page::after \{[^}]*height: calc\(var\(--sfb-bar-h, 120px\) \+ max\(12px, env\(safe-area-inset-bottom\)\) \+ 16px\);/);
    const src = readFileSync(join(__dirname, "forms-client.tsx"), "utf8");
    expect(src).toMatch(/new ResizeObserver/);
    expect(src).toMatch(/"--sfb-bar-h": `\$\{barHeight\}px`/);
  });
});
