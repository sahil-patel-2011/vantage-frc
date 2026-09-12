import { describe, expect, it } from "vitest";
import { classifyDbError, failDbWrite } from "./db-error";

/** The shape node-postgres actually raises for an integrity violation. */
function pgError(code: string, constraint: string, table: string, detail = "") {
  return Object.assign(new Error(`insert or update on table "${table}" violates constraint "${constraint}"`), {
    code,
    constraint,
    table,
    detail,
  });
}

describe("classifyDbError", () => {
  it("names the fix when an event has not been ingested from official matches", () => {
    const friendly = classifyDbError(pgError("23503", "pick_lists_event_key_fkey", "pick_lists"));
    expect(friendly?.status).toBe(422);
    expect(friendly?.eventReferenceMissing).toBe(true);
    expect(friendly?.message).toMatch(/official event/);
    // The raw constraint name must not reach the user.
    expect(friendly?.message).not.toMatch(/fkey|constraint/i);
  });

  it("distinguishes a missing match from a missing event", () => {
    const friendly = classifyDbError(
      pgError("23503", "match_strategy_cards_match_key_fkey", "match_strategy_cards"),
    );
    expect(friendly?.message).toMatch(/schedule/);
    expect(friendly?.eventReferenceMissing).toBeUndefined();
  });

  it("recognises a missing team reference from the error detail alone", () => {
    const friendly = classifyDbError(
      pgError("23503", "some_unhelpfully_named_constraint", "scout_entries", "Key (team_key)=(frc9999) is not present."),
    );
    expect(friendly?.message).toMatch(/team is not in Vantage/);
  });

  it("maps duplicates to 409 and range violations to 422", () => {
    expect(classifyDbError(pgError("23505", "x_key", "x"))?.status).toBe(409);
    expect(classifyDbError(pgError("23514", "x_check", "x"))?.status).toBe(422);
    expect(classifyDbError(pgError("23502", "", "x"))?.status).toBe(422);
  });

  it("leaves anything that is not a caller-fixable integrity error alone", () => {
    // A genuine bug (undefined column) must keep failing loudly rather than being
    // dressed up as a user mistake.
    expect(classifyDbError(pgError("42703", "", "x"))).toBeNull();
    expect(classifyDbError(new Error("forbidden"))).toBeNull();
    expect(classifyDbError("not an error")).toBeNull();
  });
});

describe("failDbWrite", () => {
  it("returns an actionable body for a missing event reference", async () => {
    const response = failDbWrite(pgError("23503", "pick_lists_event_key_fkey", "pick_lists"), "Pick-list request failed");
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; code?: string };
    expect(body.code).toBe("event_reference_missing");
    expect(body.error).not.toMatch(/violates/);
  });

  it("keeps the existing forbidden and fallback behaviour", async () => {
    const forbidden = failDbWrite(new Error("forbidden"), "fallback");
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: string }).error).toBe("Organization access denied");

    const other = failDbWrite(new Error("eventKey is required"), "fallback");
    expect(other.status).toBe(400);
    expect(((await other.json()) as { error: string }).error).toBe("eventKey is required");
  });
});
