# Event data: where it comes from

*For team admins wondering why a screen is empty, and operators configuring a deployment. Last
reviewed September 2026.*

Match schedules, results, rankings and team statistics in Vantage come from two public sources:

- **The Blue Alliance (TBA)** — the official record of FRC events, matches and rankings
- **Statbotics** — team performance statistics (EPA) computed from those results

## One cache for everyone

Vantage does **not** let each team poll these services. One background worker reads them into shared
reference tables in the database, and every team's screens read from those tables. That keeps
Vantage a polite citizen of TBA's rate limits and means the data is identical for every team.

The worker uses TBA's change validators (ETag / Last-Modified) so an unchanged event costs nothing,
retries with backoff, never runs two refreshes of the same event at once, and keeps the last good
copy of every row if a refresh fails. Every table carries a freshness timestamp that the app shows
when data is stale.

## When it refreshes

On the hosted deployment (Vercel Hobby plan, two scheduled jobs):

| Job | When | What it does |
|---|---|---|
| Event-day sync | Daily at 14:00 UTC | Refreshes active events and events teams have subscribed to |
| Season sync | Daily at 06:00 UTC | Rebuilds the year's events, teams, matches and statistics |

During a competition, a team admin can press **Sync now** on Team › Live data (`/team/data`) for the
active event at any time; platform admins have the same button under Admin → Live Data. A deployment
on a paid Vercel plan, or with an external scheduler, can call the same endpoints more often (see
[DEPLOYMENT.md](DEPLOYMENT.md)).

## The TBA key

Reading TBA needs a free **Read API v3 key** from https://www.thebluealliance.com/account.

- **Platform-wide:** the operator sets `TBA_AUTH_KEY` on the deployment (or stores a key encrypted
  under Admin → Live Data). One key covers every team.
- **Per team (fallback):** if the platform has no key, a team owner or admin can paste one on
  Team › Live data. It is encrypted on save and never shown again, and it does not start a second
  polling stream — the shared worker simply uses it.

A key pasted into a chat or an issue is exposed; rotate it.

## What else feeds in

- **Statbotics** needs no key.
- **Video analysis** and **research** can add qualitative notes and confidence-rated observations,
  with their source and timestamp. They never override an official result: if a note disagrees with
  TBA, the official value stays and the disagreement is shown.

## When a screen is empty

Competition screens stay empty until an active event is set and the reference tables have rows for
it. The screen says which of the two is missing and where to fix it.
