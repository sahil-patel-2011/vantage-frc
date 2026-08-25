import { auth } from "@vantage/core";
import { ScoutingRepository } from "@vantage/scouting/repository";
import type { SyncAcknowledgement } from "@vantage/scouting/repository";
import type { SyncEntry } from "@vantage/scouting";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

/** Deployed clients send the whole outbox in one POST — keep their contract. */
const LEGACY_MAX_BATCH = 100;
/** Per-entry clients chunk to <=50; this is a safety ceiling, not a target. */
const PER_ENTRY_MAX_BATCH = 200;

type SyncRejection = { clientId: string; reason: string };

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as {
      orgId?: string;
      entries?: SyncEntry[];
      resultsMode?: string;
    };
    // Feature detection: old clients omit resultsMode and expect the
    // all-or-nothing shape; new clients opt into per-entry results.
    const perEntry = body.resultsMode === "per-entry";
    const maxBatch = perEntry ? PER_ENTRY_MAX_BATCH : LEGACY_MAX_BATCH;
    if (!Array.isArray(body.entries) || body.entries.length > maxBatch) {
      return Response.json(
        { error: `entries must contain at most ${maxBatch} items` },
        { status: 400 },
      );
    }

    if (!perEntry) {
      // Legacy shape, unchanged: one bad entry fails the whole batch.
      const acknowledgements = await withScoutingRequest(body.orgId ?? null, async (client) => {
        const repository = new ScoutingRepository(client);
        const results = [];
        for (const entry of body.entries!) {
          results.push(await repository.syncEntry(body.orgId!, session.user.id, entry));
        }
        return results;
      });
      return Response.json({ acknowledgements });
    }

    const { acknowledgements, rejected } = await withScoutingRequest(
      body.orgId ?? null,
      async (client) => {
        const repository = new ScoutingRepository(client);
        const acks: SyncAcknowledgement[] = [];
        const failures: SyncRejection[] = [];
        for (const entry of body.entries!) {
          // Savepoint per entry so one invalid payload cannot poison the
          // withRls transaction and wedge every good entry behind it.
          await client.query("SAVEPOINT scout_sync_entry");
          try {
            acks.push(await repository.syncEntry(body.orgId!, session.user.id, entry));
            await client.query("RELEASE SAVEPOINT scout_sync_entry");
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT scout_sync_entry");
            failures.push({
              clientId: typeof entry?.clientId === "string" ? entry.clientId : "",
              reason: error instanceof Error ? error.message : "Entry rejected",
            });
          }
        }
        return { acknowledgements: acks, rejected: failures };
      },
    );
    return Response.json({
      acknowledgements,
      accepted: acknowledgements.map((ack) => ack.clientId),
      rejected,
    });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
