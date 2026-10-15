import { describe, expect, it } from "vitest";
import { serializeClientQueries } from "./serial-queries";

/** A stand-in client that records overlap, the condition pg warns about (and pg@9 will refuse). */
function fakeClient() {
  let active = 0;
  const log: string[] = [];
  const state = { overlapped: false };
  const client = {
    async query(text: unknown) {
      if (active > 0) state.overlapped = true;
      active += 1;
      log.push(`start ${String(text)}`);
      await new Promise((resolve) => setTimeout(resolve, String(text) === "slow" ? 15 : 1));
      active -= 1;
      log.push(`end ${String(text)}`);
      if (String(text) === "fail") throw new Error("boom");
      return { rows: [String(text)] };
    },
  };
  return { client, log, state };
}

describe("serializeClientQueries", () => {
  it("runs queries started together one at a time, in the order they were made", async () => {
    const { client, log, state } = fakeClient();
    const restore = serializeClientQueries(client as never);
    const results = await Promise.all([client.query("slow"), client.query("b"), client.query("c")]);
    restore();
    expect(state.overlapped).toBe(false);
    expect(results).toEqual([{ rows: ["slow"] }, { rows: ["b"] }, { rows: ["c"] }]);
    expect(log).toEqual(["start slow", "end slow", "start b", "end b", "start c", "end c"]);
  });

  it("hands each caller its own error and keeps the queue moving", async () => {
    const { client } = fakeClient();
    const restore = serializeClientQueries(client as never);
    const [failed, after] = await Promise.allSettled([client.query("fail"), client.query("after")]);
    restore();
    expect(failed.status).toBe("rejected");
    expect(after).toEqual({ status: "fulfilled", value: { rows: ["after"] } });
  });

  it("puts the client back the way it was", async () => {
    const { client } = fakeClient();
    const original = client.query;
    const restore = serializeClientQueries(client as never);
    expect(client.query).not.toBe(original);
    restore();
    expect(client.query).toBe(original);

    class Proto { async query() { return "proto"; } }
    const pooled = new Proto();
    const restorePooled = serializeClientQueries(pooled as never);
    expect(Object.prototype.hasOwnProperty.call(pooled, "query")).toBe(true);
    restorePooled();
    expect(Object.prototype.hasOwnProperty.call(pooled, "query")).toBe(false);
    expect(await pooled.query()).toBe("proto");
  });

  it("passes callback-style queries straight through", () => {
    const calls: unknown[][] = [];
    const client = { query: (...args: unknown[]) => { calls.push(args); return undefined; } };
    const restore = serializeClientQueries(client as never);
    const callback = () => undefined;
    client.query("SELECT 1", callback);
    restore();
    expect(calls).toEqual([["SELECT 1", callback]]);
  });
});
