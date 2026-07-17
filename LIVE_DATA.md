# Live data ingestion

TBA is the primary official shared source. One platform worker ingests normalized schedules, results/breakdowns, rankings/status-related payloads and available data into platform-global reference tables. ETag/Last-Modified cursors, idempotent upserts, bounded concurrency, in-flight deduplication, retry/backoff, freshness timestamps, and last-known-good rows prevent per-organization polling and ordinary-user outages.

The platform TBA Read API key is server-only and encrypted with the KMS envelope service when configured in Platform → Live Data. `TBA_AUTH_KEY` is the environment fallback (`TBA_API_KEY` is accepted as an alias). The UI never returns a key. Any key pasted into chat is exposed and must be rotated.

Event-day cron (`/api/cron/tba-sync?mode=event-day`, authorized by `CRON_SECRET`) refreshes only active and org-subscribed events about once a minute. Season cron (`mode=season`) rebuilds the year every six hours. Admins can also trigger sync from Live Data. POST a body with `eventKey` for webhook-style single-event refresh.

Owners/admins—not scouts/viewers—see fallback onboarding during sustained platform failures. They must use the official [TBA account page](https://www.thebluealliance.com/account), sign in, create a descriptively named Read API v3 key, paste it into the write-only encrypted field, test, and save. The global scheduler may use an org key by opaque ID as a controlled fallback; it does not create a duplicate polling stream.

FIRST Events API is optional when documented credentials are configured. Statbotics provides statistical EPA/prediction inputs. Other web sources require a registered HTTPS/ToS-aware adapter with robots/rate policy, provenance, timestamp, and confidence. Qualitative research never overrides official match results; conflicts preserve the official value and remain visible.
