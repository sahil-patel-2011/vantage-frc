import { describe, expect, it } from "vitest";
import { parseWorkingTodosQuery } from "./working-todos-query";

const ORG = "5f1b0c4e-6a2d-4f3b-9c1e-8a7d6b5c4e3f";
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("parseWorkingTodosQuery", () => {
  it("defaults scope to autonomous and requires uuid orgId + runId", () => {
    const ok = parseWorkingTodosQuery(new URLSearchParams({ orgId: ORG, runId: RUN }));
    expect(ok).toEqual({ ok: true, orgId: ORG, runId: RUN, scope: "autonomous" });
    const cad = parseWorkingTodosQuery(
      new URLSearchParams({ orgId: ORG, runId: RUN, scope: "cad" }),
    );
    expect(cad).toMatchObject({ ok: true, scope: "cad" });
  });

  it("refuses missing ids, junk scope, and injected SQL", () => {
    expect(parseWorkingTodosQuery(new URLSearchParams()).ok).toBe(false);
    expect(parseWorkingTodosQuery(new URLSearchParams({ orgId: "team-254", runId: RUN }))).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      parseWorkingTodosQuery(
        new URLSearchParams({ orgId: ORG, runId: `${RUN}' OR 1=1--` }),
      ),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      parseWorkingTodosQuery(new URLSearchParams({ orgId: ORG, runId: RUN, scope: "evil" })),
    ).toMatchObject({ ok: false, error: "scope is invalid" });
  });
});
