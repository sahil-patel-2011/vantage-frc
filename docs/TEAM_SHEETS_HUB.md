# Team sheets in the platform's Google Drive

Every team gets its own Google spreadsheet in a **VantageFRC** folder of one Google account
(the platform owner's), named the same way for every team — `FRC 6925 · Team Name` — with a
tab per kind of record and an **About** tab on top. It is created when the team is created
and kept up to date automatically while people use Vantage. Team owners and admins get
view-only access and a link on **Connectors**.

This is separate from a team connecting **its own** Google Sheet or Excel workbook
(Connectors → Spreadsheet copies). Both can run at once.

## Turning it on (once, ~5 minutes)

1. Sign in to Vantage as a platform admin and open **Admin → Integrations**. The
   *Team sheets in your Google Drive* card shows the script to paste; it already contains
   the server's secret (`VANTAGE_SHEETS_HUB_SECRET`, set in Vercel production on
   2026-09-24).
2. Go to <https://script.google.com/home/projects/create>, signed in as the Google account
   that should hold the sheets. Replace everything in the editor with the script and save.
3. **Deploy → New deployment → Web app.** Execute as **Me**, who has access **Anyone**.
   Allow the Drive and Sheets permissions Google asks for.
4. Copy the web app address (ends in `/exec`) into Vercel as
   `VANTAGE_SHEETS_HUB_URL` (production), and redeploy.
5. Back on Admin → Integrations, press **Check again**. It should say *On* and link the
   VantageFRC folder.

Without both env vars, nothing here runs and nothing else changes.

## How syncing works

- **When a team is created** (Admin → Create team), its spreadsheet is made right away,
  shared view-only with the owner's email.
- **While anyone on a team has Vantage open**, the app shell pings
  `POST /api/integrations/sheets/auto` on load, every 3 minutes, and 20 seconds after any
  save. At most one sync per team runs every 2 minutes.
- The server builds the same tables as the Excel/Google mirror
  (`lib/microsoft/workbook-schema`), hashes them, and **skips the write when nothing
  changed**. The hash is stored in the script's properties.
- A sync runs *as* an owner or admin of the team (the caller if they are one, otherwise
  the longest-standing owner), so the sheet holds what an owner could export. A scout's
  ping only decides *when* it refreshes and returns nothing.
- Edits made directly in these sheets are overwritten on the next sync; the About tab says
  so. Change data in Vantage.

## Updating the script

Script changes ship in `apps/web/lib/google-sheets/apps-script-source.ts`
(`APPS_SCRIPT_VERSION`). After a change, paste the new script over the old one in the same
Apps Script project and **Deploy → Manage deployments → Edit → New version** (the URL stays
the same).

## Privacy

The Privacy Policy (`lib/legal/documents.ts`) discloses this copy under *Other companies
involved* and *Where data lives*; `LEGAL_DOC_VERSION` was bumped for it (2026-09-23.1).
