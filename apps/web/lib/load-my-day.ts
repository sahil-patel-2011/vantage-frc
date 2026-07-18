import type { PoolClient } from "@neondatabase/serverless";
import type { MyDayView } from "./my-day";
import { loadMyDayView } from "./my-day-load";

/** API-facing alias: route handlers pass `orgId`; loader uses `requestedOrg`. */
export async function loadMyDay(
  client: PoolClient,
  input: { userId: string; orgId?: string | null },
): Promise<MyDayView> {
  return loadMyDayView(client, {
    userId: input.userId,
    requestedOrg: input.orgId ?? null,
  });
}

export type { MyDayView };
