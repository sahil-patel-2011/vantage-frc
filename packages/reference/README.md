# @vantage/reference

Event, match, and team data from outside Vantage — The Blue Alliance,
Statbotics, FIRST, Nexus — cached in Neon and read from there.

## TBA is a shared, rate-limited cache

Not a per-team API. Every Vantage workspace is behind the same key and the same
rate limit, so a team refreshing a page must never become a TBA request.

- **Read the Neon reference tables first.** `read-repository.ts` is the
  authenticated read path and is what product code uses.
- **One ingest worker writes.** It uses ETag / `If-None-Match` and backs off.
- **Never open parallel unrestricted polls.** One team's page refresh loop can
  exhaust the limit for everybody, and the failure lands on a different team at
  a different event.

## Reads and writes are different modules on purpose

`read-repository.ts` runs in the request path through `withRls` and only reads.
Writers (`nexus-ingest.ts`, `production-worker.ts`) are worker-only, idempotent,
and use the admin role because they operate across teams — which is exactly why
nothing in the request path may import them.

Idempotent means: running the same ingest twice leaves the same rows. An ingest
that double-counts a match is worse than one that did not run.

## Off-season and unofficial events

Much of this data simply does not exist for an off-season event, a week-0
scrimmage, or the first morning of week 1. That is not an error state to paper
over — it is the normal case, and it is why
`@vantage/prediction-strategy` can build ratings from a team's own scouting
instead. Reference data returns nothing and the product carries on.

## Layout

| File | What it holds |
| --- | --- |
| `read-repository.ts` | Authenticated reads of the cached tables |
| `http.ts` | The rate-limited, ETag-aware client |
| `cache-ttl.ts` | How long each kind of row stays fresh |
| `source-registry.ts` | Which upstream owns which fact |
| `nexus-client.ts` / `nexus-ingest.ts` | Venue and queue data |
| `first-events-client.ts` | FIRST's own event API |
| `match-cross-validation.ts` | Checking one source against another |
| `credential-store.ts` / `platform-key.ts` | Upstream keys, never per-team |
| `production-worker.ts` | The one writer |

Setup and which keys are optional: [`docs/LIVE_DATA.md`](../../docs/LIVE_DATA.md).
