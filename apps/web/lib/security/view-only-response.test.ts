/**
 * A View only member's refused write answers 403 with one sentence on every shared
 * error path (0715), and the page never sees a database error for it.
 */
import { describe, expect, it } from "vitest";
import { VIEW_ONLY_MESSAGE, ViewOnlyError } from "@vantage/db/view-only";
import { publicErrorMessage, viewOnlyResponse } from "./public-error";
import { securityErrorResponse } from "./request";
import { tenantErrorResponse } from "../tenant-org-access";
import { scoutingErrorResponse } from "../scouting-auth";
import { failMeteredAi } from "../metered-ai-fail";
import { driveErrorResponse } from "../drive/api";

const RAW_REFUSAL = Object.assign(new Error(VIEW_ONLY_MESSAGE), { code: "42501", detail: "vantage:view_only" });
const GENERIC_RLS = Object.assign(new Error('new row violates row-level security policy for table "build_tasks"'), {
  code: "42501",
});

async function expectViewOnly(response: Response) {
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({ error: VIEW_ONLY_MESSAGE, reason: "view_only" });
}

describe("View only answers", () => {
  it("publicErrorMessage passes the View only sentence through and still hides other database errors", () => {
    expect(publicErrorMessage(new ViewOnlyError(), "Task board request failed")).toBe(VIEW_ONLY_MESSAGE);
    expect(publicErrorMessage(RAW_REFUSAL, "Task board request failed")).toBe(VIEW_ONLY_MESSAGE);
    expect(publicErrorMessage(GENERIC_RLS, "Task board request failed")).toBe("Task board request failed");
  });

  it("viewOnlyResponse is a 403 for a viewer and null for anything else", async () => {
    await expectViewOnly(viewOnlyResponse(new ViewOnlyError())!);
    await expectViewOnly(viewOnlyResponse(RAW_REFUSAL)!);
    expect(viewOnlyResponse(GENERIC_RLS)).toBeNull();
    expect(viewOnlyResponse(new Error("title is required"))).toBeNull();
  });

  it.each([
    ["tenantErrorResponse", (error: unknown) => tenantErrorResponse(error)],
    ["scoutingErrorResponse", (error: unknown) => scoutingErrorResponse(error)],
    ["securityErrorResponse", (error: unknown) => securityErrorResponse(error, "Request failed")],
    ["failMeteredAi", (error: unknown) => failMeteredAi(error, "AI request failed")],
    ["driveErrorResponse", (error: unknown) => driveErrorResponse(error)],
  ])("%s maps a viewer's refusal to 403", async (_name, respond) => {
    await expectViewOnly(respond(new ViewOnlyError()));
    await expectViewOnly(respond(RAW_REFUSAL));
  });

  it("security responses stay private", () => {
    expect(securityErrorResponse(new ViewOnlyError(), "x").headers.get("cache-control")).toContain("no-store");
  });
});
