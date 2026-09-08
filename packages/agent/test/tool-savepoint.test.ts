import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { AIToolRegistry, type ToolDefinition } from "../src/orchestrator";

/**
 * Every tool in an agent turn shares one `withRls` PoolClient, so they all run in
 * a single transaction. `tools.ts` catches its own SQL errors and returns
 * `{setup_required:true}` in dozens of places — which leaves the transaction
 * ABORTED, so every later tool used to fail with "current transaction is
 * aborted" and report setup_required too. One broken query silently emptied the
 * rest of the agent's answer while the HTTP status stayed 200.
 *
 * These tests pin the savepoint that bounds a failure to the tool that caused it.
 */

/** Minimal Postgres stand-in with the real aborted-transaction rule. */
function makeTxClient() {
  const log: string[] = [];
  let aborted = false;
  const client = {
    async query(sql: string) {
      log.push(sql);
      if (/^SAVEPOINT /.test(sql)) return { rows: [] };
      if (/^ROLLBACK TO SAVEPOINT /.test(sql)) {
        aborted = false;
        return { rows: [] };
      }
      // Postgres refuses everything but ROLLBACK once a statement has failed.
      if (aborted) {
        const error = Object.assign(new Error("current transaction is aborted"), { code: "25P02" });
        throw error;
      }
      if (/^RELEASE SAVEPOINT /.test(sql)) return { rows: [] };
      if (/BOOM/.test(sql)) {
        aborted = true;
        throw Object.assign(new Error('column "boom" does not exist'), { code: "42703" });
      }
      return { rows: [{ ok: 1 }] };
    },
  } as unknown as PoolClient;
  return { client, log, isAborted: () => aborted };
}

function tool(name: string, run: (client: PoolClient) => Promise<unknown>): ToolDefinition<unknown, unknown> {
  return {
    name,
    description: name,
    parseInput: (value: unknown) => value,
    parseOutput: (value: unknown) => value,
    execute: async ({ client }) => run(client),
  };
}

describe("AIToolRegistry transaction isolation", () => {
  it("keeps a tool that swallows its own SQL error from breaking every later tool", async () => {
    const { client, isAborted } = makeTxClient();
    const registry = new AIToolRegistry()
      // The real tools.ts shape: catch, and degrade to setup_required.
      .register(
        tool("broken.tool", async (c) => {
          try {
            await c.query("SELECT BOOM FROM anything");
            return { ok: true };
          } catch {
            return { setup_required: true };
          }
        }),
      )
      .register(tool("healthy.tool", async (c) => (await c.query("SELECT 1")).rows[0]));

    const context = { client, orgId: "org", userId: "user", activeEventKey: null };

    // The failing tool still reports its own graceful result...
    expect(await registry.invoke("broken.tool", context, {})).toEqual({ setup_required: true });
    // ...and the transaction has been repaired rather than left aborted.
    expect(isAborted()).toBe(false);
    // The next tool runs for real instead of reporting a phantom setup_required.
    expect(await registry.invoke("healthy.tool", context, {})).toEqual({ ok: 1 });
  });

  it("rethrows a tool that does not catch, after repairing the transaction", async () => {
    const { client } = makeTxClient();
    const registry = new AIToolRegistry()
      .register(tool("throwing.tool", async (c) => (await c.query("SELECT BOOM")).rows))
      .register(tool("healthy.tool", async (c) => (await c.query("SELECT 1")).rows[0]));
    const context = { client, orgId: "org", userId: "user", activeEventKey: null };

    await expect(registry.invoke("throwing.tool", context, {})).rejects.toThrow(/does not exist/);
    expect(await registry.invoke("healthy.tool", context, {})).toEqual({ ok: 1 });
  });

  it("releases the savepoint on the happy path and leaves results untouched", async () => {
    const { client, log } = makeTxClient();
    const registry = new AIToolRegistry().register(tool("fine.tool", async (c) => (await c.query("SELECT 1")).rows[0]));
    const context = { client, orgId: "org", userId: "user", activeEventKey: null };

    expect(await registry.invoke("fine.tool", context, {})).toEqual({ ok: 1 });
    expect(log.filter((sql) => sql.startsWith("SAVEPOINT"))).toHaveLength(1);
    expect(log.filter((sql) => sql.startsWith("RELEASE SAVEPOINT"))).toHaveLength(1);
    expect(log.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT"))).toBe(false);
  });

  it("still runs the tool when there is no usable transaction to protect", async () => {
    // A unit-test stub or autocommit client rejects SAVEPOINT; the tool must run.
    const client = {
      async query(sql: string) {
        if (/^SAVEPOINT /.test(sql)) throw new Error("no transaction");
        return { rows: [{ ok: 1 }] };
      },
    } as unknown as PoolClient;
    const registry = new AIToolRegistry().register(tool("fine.tool", async (c) => (await c.query("SELECT 1")).rows[0]));

    expect(
      await registry.invoke("fine.tool", { client, orgId: "org", userId: "user", activeEventKey: null }, {}),
    ).toEqual({ ok: 1 });
  });
});
