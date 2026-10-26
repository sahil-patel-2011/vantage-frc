import { describe, expect, it } from "vitest";
import { formatQueryValue, inlinePlaceholders, installQueryWaves, isBatchableStatement } from "./query-waves";

describe("query waves", () => {
  it("treats reads and writes as batchable and leaves transaction control alone", () => {
    expect(isBatchableStatement("SELECT 1")).toBe(true);
    expect(isBatchableStatement("  with rows as (select 1) select * from rows")).toBe(true);
    expect(isBatchableStatement("UPDATE widgets SET name = 'a' WHERE id = $1")).toBe(true);
    expect(isBatchableStatement("BEGIN")).toBe(false);
    expect(isBatchableStatement("SAVEPOINT vantage_sp_1")).toBe(false);
    expect(isBatchableStatement("SELECT 1; SELECT 2")).toBe(false);
  });

  it("inlines placeholders once, highest index first in spirit, without revisiting literals", () => {
    expect(inlinePlaceholders("select $1, $2, $10", ["a", "b", 3, 4, 5, 6, 7, 8, 9, "has $1 inside"])).toBe(
      "select 'a', 'b', 'has $1 inside'",
    );
    expect(formatQueryValue(null)).toBe("NULL");
    expect(formatQueryValue(true)).toBe("TRUE");
    expect(formatQueryValue(["x", "y"])).toBe("ARRAY['x','y']");
  });

  it("sends reads started together as one script and keeps their order", async () => {
    const calls: string[] = [];
    const client = {
      async query(text: unknown, _values?: unknown) {
        const sql = String(text);
        calls.push(sql);
        if (sql.includes("SAVEPOINT") && sql.includes("SELECT")) {
          const selects = sql.split(";").map((part) => part.trim()).filter((part) => part.startsWith("SELECT"));
          return [ { command: "SAVEPOINT" }, ...selects.map((statement) => ({ rows: [statement], command: "SELECT" })), { command: "RELEASE" } ];
        }
        return { rows: [sql] };
      },
    };
    const restore = installQueryWaves(client as never);
    const results = await Promise.all([
      client.query("SELECT a"),
      client.query("SELECT b", []),
      client.query("SELECT c WHERE id = $1", ["ok"]),
    ]);
    restore();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("SELECT a");
    expect(calls[0]).toContain("SELECT b");
    expect(calls[0]).toContain("SELECT c WHERE id = 'ok'");
    expect(results.map((row) => (row as { rows: string[] }).rows[0])).toEqual([
      "SELECT a",
      "SELECT b",
      "SELECT c WHERE id = 'ok'",
    ]);
  });

  it("rides the transaction prelude on the first batched script", async () => {
    const calls: string[] = [];
    const client = {
      async query(text: unknown, _values?: unknown) {
        const sql = String(text);
        calls.push(sql);
        const parts = sql.split(";").map((part) => part.trim()).filter(Boolean);
        return parts.map((part) => ({ command: part.slice(0, 20), rows: [part] }));
      },
    };
    const restore = installQueryWaves(client as never);
    restore.setPrelude("BEGIN; SET LOCAL ROLE vantage_app; SELECT set_config('app.user_id', 'u', true)");
    const results = await Promise.all([client.query("SELECT a"), client.query("SELECT b")]);
    restore();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.startsWith("BEGIN;")).toBe(true);
    expect(calls[0]).toContain("SELECT a");
    expect(restore.preludePending()).toBe(false);
    expect(results.map((row) => (row as unknown as { rows: string[] }).rows[0])).toEqual(["SELECT a", "SELECT b"]);
  });

  it("does not batch a later read that needs the first answer", async () => {
    const calls: string[] = [];
    const client = {
      async query(text: unknown) {
        calls.push(String(text));
        return { rows: [String(text)] };
      },
    };
    const restore = installQueryWaves(client as never);
    const first = await client.query("SELECT first");
    const second = await client.query("SELECT second");
    restore();
    expect(first).toEqual({ rows: ["SELECT first"] });
    expect(second).toEqual({ rows: ["SELECT second"] });
    expect(calls).toEqual(["SELECT first", "SELECT second"]);
  });

  it("runs a failed batch one statement at a time after rolling back the wave", async () => {
    const calls: string[] = [];
    const client = {
      async query(text: unknown, values?: unknown[]) {
        const sql = String(text);
        calls.push(sql);
        if (sql.includes("SELECT bad") && sql.includes("SELECT good")) throw new Error("batch failed");
        if (sql === "SELECT bad") throw new Error("bad row");
        return { rows: [values ?? sql] };
      },
    };
    const restore = installQueryWaves(client as never);
    const [bad, good] = await Promise.allSettled([client.query("SELECT bad"), client.query("SELECT good")]);
    restore();
    expect(calls.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT vantage_wave_"))).toBe(true);
    expect(bad.status).toBe("rejected");
    expect(good.status).toBe("fulfilled");
  });
});
