import { describe, expect, it } from "vitest";
import {
  asLessonRole,
  canChangeLessonStatus,
  canCreateLessons,
  canDeleteLesson,
  canEditLesson,
  canManageLessons,
  canPublishLesson,
  editRefusal,
} from "./permissions";

const me = "user-me";
const other = "user-other";
const myDraft = { createdBy: me, status: "draft" as const };
const myPublished = { createdBy: me, status: "published" as const };
const theirDraft = { createdBy: other, status: "draft" as const };

describe("team lesson permissions (mirror of 0717's policies)", () => {
  it("reads only the four team roles", () => {
    expect(["owner", "admin", "scout", "viewer"].map(asLessonRole)).toEqual(["owner", "admin", "scout", "viewer"]);
    expect(asLessonRole("mentor")).toBeNull();
    expect(asLessonRole(undefined)).toBeNull();
  });

  it("lets owners and admins do everything", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(canManageLessons(role)).toBe(true);
      expect(canCreateLessons(role)).toBe(true);
      expect(canEditLesson(role, me, theirDraft)).toBe(true);
      expect(canEditLesson(role, me, { createdBy: other, status: "published" })).toBe(true);
      expect(canDeleteLesson(role, me, { createdBy: other, status: "published" })).toBe(true);
      expect(canChangeLessonStatus(role)).toBe(true);
    }
  });

  it("lets a team member write, edit and publish their own draft only", () => {
    expect(canCreateLessons("scout")).toBe(true);
    expect(canManageLessons("scout")).toBe(false);
    expect(canEditLesson("scout", me, myDraft)).toBe(true);
    expect(canPublishLesson("scout", me, myDraft)).toBe(true);
    expect(canEditLesson("scout", me, myPublished)).toBe(false);
    expect(canPublishLesson("scout", me, myPublished)).toBe(false);
    expect(canEditLesson("scout", me, theirDraft)).toBe(false);
    expect(canDeleteLesson("scout", me, myDraft)).toBe(true);
    expect(canDeleteLesson("scout", me, myPublished)).toBe(false);
    expect(canChangeLessonStatus("scout")).toBe(false);
  });

  it("keeps View only members to reading and practising", () => {
    expect(canCreateLessons("viewer")).toBe(false);
    expect(canEditLesson("viewer", me, myDraft)).toBe(false);
    expect(canDeleteLesson("viewer", me, myDraft)).toBe(false);
    expect(editRefusal("viewer", me, myDraft)).toMatch(/View only/);
  });

  it("explains a refusal in words a student can act on", () => {
    expect(editRefusal("scout", me, theirDraft)).toMatch(/person who wrote this lesson/);
    expect(editRefusal("scout", me, myPublished)).toMatch(/back to draft/);
  });
});
