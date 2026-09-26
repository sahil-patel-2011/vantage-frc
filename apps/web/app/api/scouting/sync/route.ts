import { auth } from "@vantage/core";
import { withSavepoint } from "@vantage/db";
import { ScoutingRepository } from "@vantage/scouting/repository";
import type { SyncAcknowledgement } from "@vantage/scouting/repository";
import type { SyncEntry } from "@vantage/scouting";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import { mediaLinkJobsAfterMint } from "../../../../lib/scouting/attach-media-wire";
import {
  backfillScoutMediaFromPayload,
  linkScoutMediaToEntry,
} from "../../../../lib/scouting/scout-media-link";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";
import { publicErrorMessage } from "../../../../lib/security/public-error";
import {
  MISSING_REFERENCE_REASON,
  isMissingReferenceError,
  isTransientDbError,
  resolveSyncTarget,
} from "../../../../lib/scouting/sync-guards";

/**
 * After an entry mints, stamp scout_media.entry_id from payload refs and the entry_client tag.
 *
 * This is the last thing the request does before COMMIT, and it used to be a bare
 * `try { … } catch {}`. On a deploy whose `scout_media` was older than this query
 * the failing statement aborted the shared `withRls` transaction, so the COMMIT
 * that was supposed to persist the whole scouting batch rolled back instead —
 * while the route still returned 200 with a full list of acknowledgements. An
 * offline scout's outbox would clear against acknowledgements for rows that no
 * longer existed. A savepoint bounds the failure to the media link.
 *
 * Returns false when the link could not be applied so the caller can say so.
 */
async function stampLinkedMediaAfterMint(
  client: PoolClient,
  orgId: string,
  acknowledgements: ReadonlyArray<{ clientId: string; entryId?: string | null }>,
  entries: ReadonlyArray<SyncEntry>,
): Promise<boolean> {
  return withSavepoint(
    client,
    async () => {
      for (const job of mediaLinkJobsAfterMint({ acknowledgements, entries })) {
        await backfillScoutMediaFromPayload(client, {
          orgId,
          entryId: job.entryId,
          payload: job.payload,
        });
        if (!job.entryClientTag) continue;
        const tagged = await client.query<{ clientId: string }>(
          `SELECT client_id AS "clientId"
           FROM scout_media
           WHERE org_id = $1::uuid
             AND entry_id IS NULL
             AND $2 = ANY(tags)`,
          [orgId, job.entryClientTag],
        );
        await linkScoutMediaToEntry(client, {
          orgId,
          entryId: job.entryId,
          mediaClientIds: tagged.rows.map((row) => row.clientId),
        });
      }
      return true;
    },
    false,
  );
}

/** Deployed clients send the whole outbox in one POST — keep their contract. */
const LEGACY_MAX_BATCH = 100;
/** Per-entry clients chunk to <=50; this is a safety ceiling, not a target. */
const PER_ENTRY_MAX_BATCH = 200;

type SyncRejection = { clientId: string; reason: string };

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
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
      const { acknowledgements, mediaLinked } = await withScoutingRequest(
        body.orgId ?? null,
        async (client) => {
          const repository = new ScoutingRepository(client);
          const results = [];
          for (const entry of body.entries!) {
            const target = await resolveSyncTarget(client, { orgId: body.orgId!, userId: session.user.id, entry });
            if (target.kind === "refuse") throw new Error(target.reason);
            const ack = await repository.syncEntry(body.orgId!, session.user.id, target.entry);
            results.push({ ...ack, clientId: entry.clientId });
          }
          const linked = await stampLinkedMediaAfterMint(client, body.orgId!, results, body.entries!);
          return { acknowledgements: results, mediaLinked: linked };
        },
      );
      return Response.json({
        acknowledgements,
        ...(mediaLinked ? {} : { mediaLinkDeferred: true }),
      });
    }

    const { acknowledgements, rejected, mediaLinked } = await withScoutingRequest(
      body.orgId ?? null,
      async (client) => {
        const repository = new ScoutingRepository(client);
        const acks: SyncAcknowledgement[] = [];
        const failures: SyncRejection[] = [];
        // One report per scout per robot, and never across robots (lib/scouting/sync-guards.ts).
        // The acknowledgement always carries the id the phone sent, so its outbox row clears.
        const fileOne = async (entry: SyncEntry): Promise<SyncAcknowledgement | SyncRejection> => {
          const target = await resolveSyncTarget(client, { orgId: body.orgId!, userId: session.user.id, entry });
          if (target.kind === "refuse") return { clientId: entry.clientId, reason: target.reason };
          const ack = await repository.syncEntry(body.orgId!, session.user.id, target.entry);
          return { ...ack, clientId: entry.clientId };
        };
        const settle = (outcome: SyncAcknowledgement | SyncRejection) => {
          if ("reason" in outcome) failures.push(outcome);
          else acks.push(outcome);
        };
        for (const entry of body.entries!) {
          // Savepoint per entry so one invalid payload cannot poison the
          // withRls transaction and wedge every good entry behind it.
          await client.query("SAVEPOINT scout_sync_entry");
          try {
            settle(await fileOne(entry));
            await client.query("RELEASE SAVEPOINT scout_sync_entry");
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT scout_sync_entry");
            // The same entry arriving twice at once (two tabs, or the page and the app frame both
            // draining the outbox when signal returns): the other request has just committed it.
            // Read it again and answer "duplicate"; it used to come back "Entry rejected" for an
            // entry that was saved, and the scout was asked to retry or discard it.
            if ((error as { code?: string } | null)?.code === "23505") {
              await client.query("SAVEPOINT scout_sync_entry");
              try {
                settle(await fileOne(entry));
                await client.query("RELEASE SAVEPOINT scout_sync_entry");
                continue;
              } catch {
                await client.query("ROLLBACK TO SAVEPOINT scout_sync_entry");
              }
            }
            // A lost race, a deadlock or a timeout is not the scout's mistake: leave the entry
            // unanswered so the phone keeps it queued and sends it again, instead of setting it
            // aside as "rejected".
            if (isTransientDbError(error)) continue;
            failures.push({
              clientId: typeof entry?.clientId === "string" ? entry.clientId : "",
              reason: isMissingReferenceError(error)
                ? MISSING_REFERENCE_REASON
                : publicErrorMessage(error, "Entry rejected"),
            });
          }
        }
        const linked = await stampLinkedMediaAfterMint(client, body.orgId!, acks, body.entries!);
        return { acknowledgements: acks, rejected: failures, mediaLinked: linked };
      },
    );
    return Response.json({
      acknowledgements,
      accepted: acknowledgements.map((ack) => ack.clientId),
      rejected,
      ...(mediaLinked ? {} : { mediaLinkDeferred: true }),
    });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
