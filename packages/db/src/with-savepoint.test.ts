import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "./index";

/**
 * withRls runs a whole request inside one transaction, so a `try { … } catch {}`
 * around an optional query leaves Postgres in the aborted state and every later
 * statement in that request fails with "current transaction is aborted". These
 * assertions pin the savepoint behaviour that keeps the blast radius to one
 * statement.
 */
function fakeClient(queries: string[]): PoolClient {
  return {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
}

describe("withSavepoint", () => {
  it("releases the savepoint and returns the value when the work succeeds", async () => {
    const queries: string[] = [];
    const client = fakeClient(queries);

    const result = await withSavepoint(client, async () => "written", "fallback");

    expect(result).toBe("written");
    expect(queries[0]).toMatch(/^SAVEPOINT /);
    expect(queries[1]).toMatch(/^RELEASE SAVEPOINT /);
    expect(queries.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT"))).toBe(false);
  });

  it("rolls back to the savepoint and returns the fallback when the work throws", async () => {
    const queries: string[] = [];
    const client = fakeClient(queries);

    const result = await withSavepoint(
      client,
      async () => {
        throw new Error('invalid input syntax for type integer: "3.4"');
      },
      null,
    );

    expect(result).toBeNull();
    const name = queries[0]!.replace("SAVEPOINT ", "");
    expect(queries[1]).toBe(`ROLLBACK TO SAVEPOINT ${name}`);
    expect(queries[2]).toBe(`RELEASE SAVEPOINT ${name}`);
  });

  it("uses a distinct savepoint name per call so nested releases cannot collide", async () => {
    const queries: string[] = [];
    const client = fakeClient(queries);

    await withSavepoint(client, async () => 1, 0);
    await withSavepoint(client, async () => 2, 0);

    const names = queries.filter((sql) => sql.startsWith("SAVEPOINT "));
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
  });

  it("still guards the work when no transaction is open to take a savepoint in", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("SAVEPOINT")) throw new Error("no transaction in progress");
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;

    await expect(
      withSavepoint(
        client,
        async () => {
          throw new Error("still broken");
        },
        "fallback",
      ),
    ).resolves.toBe("fallback");
  });
});
