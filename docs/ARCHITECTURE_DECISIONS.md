# Architecture decisions

*Decisions that change the shape of the system, with the reasoning, so a later developer knows why and
not only what. Newest first.*

---

## ADR-004: Scouting's address is a sibling of Vantage's, not a subdomain of it

**Proposed:** Serve Scouting at `scouting.vantagefrc.vercel.app`.

**Decision:** Serve it at `vantagefrc-scouting.vercel.app` from the same deployment, and move both to
`vantagefrc.com` / `scouting.vantagefrc.com` once a domain is bought.

**Why:** Vercel does not issue nested subdomains under a project's `vercel.app` address; only custom
domains get them. `vercel.app` is also a public suffix, so no two `*.vercel.app` hosts can share a
session cookie. Signing in once therefore needs a one-time handoff between the hosts; see
[PRODUCTS.md](PRODUCTS.md).

**Consequences:** One extra redirect when switching products on `vercel.app` addresses. None on a
custom domain.

---

## ADR-003: Excel and OneDrive are a synced copy, not the transactional database

**Proposed:** Use Microsoft Excel / OneDrive as the application database, to use Microsoft 365
storage that is already paid for and avoid a database bill.

**Decision:** Postgres stays the single source of truth. Excel/OneDrive is a first-class integration:
a team connects its Microsoft account and Vantage keeps a structured workbook in its OneDrive up to
date, for human-readable copies, coach editing, backups and analysis. Details are in
[MICROSOFT_EXCEL.md](MICROSOFT_EXCEL.md).

**Why:** The goal behind the proposal was "no recurring database cost". It is met without Excel,
because the Postgres Vantage already runs on is on a free tier. Using a spreadsheet as the
transactional store would have cost correctness:

- **Simultaneous scouting.** Six scouts saving at once need atomic, isolated writes. A workbook has
  no transactions, and concurrent writes to one file conflict or are throttled.
- **Duplicates and integrity.** Offline sync relies on unique constraints (`org_id, client_id`) to
  make retries safe. Spreadsheets have none; duplicate prevention would become a best-effort scan.
- **Security.** Every team's data is isolated by row-level security enforced in the database. A
  shared workbook has no per-row access control; isolating it would move all security into
  application code.
- **Speed and limits.** Microsoft Graph workbook calls are remote HTTP with per-app and per-file
  throttling, typically hundreds of milliseconds each. The pick list, predictions and command center
  run dozens of indexed queries per view.
- **Features that need a database.** Chat, notifications, audit logs and AI activity all need
  ordered, queryable, append-heavy storage.

**Consequences:** Nothing is lost that the proposal was reaching for. Data still lands in the team's
own Microsoft storage, readable and editable in Excel. The sync is written against a small interface,
so it can target another destination later. Import from Excel back into Vantage is designed as a
follow-up rather than half-built.

---

## ADR-002: Base44 is not added as a database

**Proposed:** Optionally use a Base44 app as a database.

**Decision:** Not adopted.

**Why:** It would add a second system of record next to Postgres, with its own access model and no
row-level security integration with Better Auth sessions. That creates the sync, duplication and
authorization problems ADR-003 avoids, without adding any capability Postgres lacks. The only case
for it would be a provider we could not otherwise afford, and the free Postgres tier already covers
Vantage's scale.

---

## ADR-001: Scouting features are our own implementation, informed by public descriptions

**Proposed:** Download Lovat's source code and copy its scouting and data-presentation code.

**Decision:** Lovat's repositories (HighlanderRobotics/lovat, lovat-server, lovat-collection) carry no
open-source license, so their code is all rights reserved and is not copied. Vantage implements the
same ideas independently, on its own data model: team lookup with field-relative stats and
sparklines, a win chance from alliance score distributions, slider-weighted z-score pick lists, and
mutable shared pick lists. The inputs were Lovat's public product pages and guides.

**Why:** Copying unlicensed code would expose the project to an infringement claim, and it would
contradict this project's own position that nobody may take and pass off Vantage's code. Ideas and
presentation patterns are free to build on; source code is not.
