import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The chat long-poll must not sleep while holding a pooled connection inside a
 * withRls transaction: the request pool is 8 connections (3 on Supabase), so a
 * handful of open chat tabs idling in transaction starved every other route.
 * Also locks the team-chat fan-out to the batched notification helper.
 */
const ROUTE = readFileSync(join(__dirname, "../../app/api/messages/route.ts"), "utf8");

function getHandlerBody(): string {
  const start = ROUTE.indexOf("export async function GET(");
  const end = ROUTE.indexOf("export async function POST(");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return ROUTE.slice(start, end);
}

describe("messages long-poll connection use", () => {
  it("waits outside the request transaction, one short withRls per probe", () => {
    const get = getHandlerBody();
    const mainTx = get.slice(get.indexOf("const data = await withRls("));
    expect(mainTx).not.toMatch(/\bsleep\(/);
    expect(mainTx).not.toMatch(/hasThreadUpdates\(/);
    expect(get.indexOf("waitForThreadUpdates(")).toBeLessThan(get.indexOf("const data = await withRls("));

    const waiter = ROUTE.slice(ROUTE.indexOf("async function waitForThreadUpdates("));
    const loop = waiter.slice(0, waiter.indexOf("\n}\n"));
    // The sleep sits after the probe's withRls has returned, never inside it.
    expect(loop).toMatch(/await withRls\(context, async \(client\) => \{[\s\S]*?\}\);[\s\S]*await sleep\(/);
  });

  it("keeps the membership and team-chat gate ahead of any waiting", () => {
    const waiter = ROUTE.slice(ROUTE.indexOf("async function waitForThreadUpdates("));
    expect(waiter).toMatch(/if \(first\) \{\s*await requireMembership\(client, orgId, userId\);\s*const gate = await youthProtectionState/);
  });

  it("fans team-chat notifications out through the batched helper", () => {
    expect(ROUTE).toMatch(/await emitPreferredNotifications\(client, \[/);
    expect(ROUTE).not.toMatch(/emitPreferredNotification\(client,/);
  });
});
