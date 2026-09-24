/**
 * Team sheets in the platform's own Google Drive ("hub mode").
 *
 * One Apps Script, deployed once by the platform owner as a standalone web app, keeps a
 * spreadsheet for every team in a "VantageFRC" folder of that Google account, each named the
 * same way ("6925 - Team Name - VantageFRC") and opening on an About tab. Vantage writes the same
 * tables the team's own Google/Excel copy gets (lib/microsoft/workbook-schema), then stamps
 * the content hash in the script, so a sync with nothing new costs one small request.
 *
 * Configured by two server env vars, never by a team:
 *   VANTAGE_SHEETS_HUB_URL     the web app address (https://script.google.com/macros/s/…/exec)
 *   VANTAGE_SHEETS_HUB_SECRET  64 hex characters, the same value as VANTAGE_SECRET in the script
 * Without both, every call here reports "not_configured" and nothing else changes.
 *
 * Runs on the caller's withRls client, as an owner or admin of the team (the caller checks
 * that), so it reads exactly what that person could export themselves.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { buildAllTables } from "../microsoft/team-ops-tables";
import type { WorkbookSource } from "../microsoft/workbook-schema";
import { loadWorkbookSource, summarizeOutcomes } from "../microsoft/workbook-sync";
import { contentHash, withMirrorInfo } from "../mirror/mirror-hash";
import { writeTablesToCopy } from "../mirror/mirror-sync";
import { AppsScriptBridge, AppsScriptTarget, type HubTeam, type HubTeamBook } from "./apps-script-bridge";
import { isAppsScriptSecret, isAppsScriptUrl } from "./apps-script-source";
import { describeGoogleError, isGoogleSheetsError } from "./google-api";

export type SheetsHubConfig = { url: string; secret: string };

export function sheetsHubConfig(env: NodeJS.ProcessEnv = process.env): SheetsHubConfig | null {
  const url = env.VANTAGE_SHEETS_HUB_URL?.trim() ?? "";
  const secret = env.VANTAGE_SHEETS_HUB_SECRET?.trim().toLowerCase() ?? "";
  if (!isAppsScriptUrl(url) || !isAppsScriptSecret(secret)) return null;
  return { url, secret };
}

export function sheetsHubBridge(config: SheetsHubConfig | null = sheetsHubConfig()): AppsScriptBridge | null {
  return config ? new AppsScriptBridge(config.url, config.secret) : null;
}

/** The standard name every team's spreadsheet gets. Mirrors vantageTeamTitle_ in the script. */
export function teamSheetTitle(teamNumber: number | null, name: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (teamNumber && clean) return `${teamNumber} - ${clean} - VantageFRC`;
  if (teamNumber) return `${teamNumber} - VantageFRC`;
  return `${clean || "Team"} - VantageFRC`;
}

/**
 * Whether team owners and admins get view access to their hub spreadsheet. Off unless the
 * platform turns it on: the hub is the platform's own copy of team data, not a team feature.
 * With it off, the script also takes back any access it granted earlier.
 */
export function sheetsHubSharesWithTeams(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VANTAGE_SHEETS_HUB_SHARE?.trim() === "1";
}

/** The team as the script sees it: id, number, name, and the owners/admins who may view it. */
export async function readHubTeam(client: PoolClient, orgId: string): Promise<HubTeam | null> {
  const org = (
    await client.query<{ name: string; teamNumber: number | null }>(
      `SELECT name, team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid LIMIT 1`,
      [orgId],
    )
  ).rows[0];
  if (!org) return null;
  const viewers = (
    await client.query<{ email: string }>(
      `SELECT lower(u.email) AS email
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1::uuid AND m.role::text IN ('owner', 'admin') AND u.email IS NOT NULL
        ORDER BY m.created_at ASC
        LIMIT 20`,
      [orgId],
    )
  ).rows.map((row) => row.email);
  return {
    key: orgId,
    number: org.teamNumber ?? null,
    name: org.name,
    title: teamSheetTitle(org.teamNumber ?? null, org.name),
    viewers: sheetsHubSharesWithTeams() ? viewers : [],
  };
}

export type HubSyncResult =
  | { status: "not_configured" }
  | { status: "busy" }
  | { status: "no_team" }
  | { status: "unchanged"; book: HubTeamBook }
  | { status: "succeeded" | "partial" | "failed"; book: HubTeamBook | null; rowsWritten: number; error: string | null };

/**
 * Bring this team's hub spreadsheet up to date. Creates it on first use. Skips the write when
 * the tables hash to what was last written, unless `force`.
 */
export async function syncTeamToHub(
  client: PoolClient,
  orgId: string,
  options: { force?: boolean; bridge?: AppsScriptBridge | null; now?: () => Date } = {},
): Promise<HubSyncResult> {
  const bridge = options.bridge === undefined ? sheetsHubBridge() : options.bridge;
  if (!bridge) return { status: "not_configured" };
  const now = options.now ?? (() => new Date());

  // One hub writer per team at a time; a second trigger simply finds it busy.
  const locked = (
    await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('sheets-hub:' || $1::text, 0)) AS locked`,
      [orgId],
    )
  ).rows[0]?.locked;
  if (!locked) return { status: "busy" };

  const team = await readHubTeam(client, orgId);
  if (!team) return { status: "no_team" };

  const source = await loadWorkbookSource(client, orgId);
  const built = buildAllTables(source, now());
  const hash = contentHash(built);

  let book: HubTeamBook;
  try {
    book = await bridge.ensureTeamBook(team);
  } catch (error) {
    return { status: "failed", book: null, rowsWritten: 0, error: describeGoogleError(error) };
  }
  if (!options.force && !book.created && book.lastHash === hash) return { status: "unchanged", book };

  const target = new AppsScriptTarget(bridge, team);
  const { outcomes } = await writeTablesToCopy(target, withMirrorInfo(built, hash, ["google"]), {
    describe: describeGoogleError,
    isFatal: (error) => isGoogleSheetsError(error) && error.kind === "auth_expired",
    throttle: (error) => (isGoogleSheetsError(error) && error.kind === "throttled" ? (error.retryAfterMs ?? 0) : null),
  });
  const summary = summarizeOutcomes(outcomes);
  if (summary.status === "succeeded") {
    try {
      await bridge.stampTeamBook(team, hash, built.map((table) => table.spec.sheet));
      book = { ...book, lastHash: hash, lastSyncAt: now().toISOString() };
    } catch {
      // The data landed; without the stamp the next sync just writes it again.
    }
  }
  return { status: summary.status, book, rowsWritten: summary.rowsWritten, error: summary.error };
}

/** A team with nothing in it yet: every table exists, with its columns and no rows. */
export function emptyTeamSource(team: HubTeam): WorkbookSource {
  return {
    orgName: team.name,
    teamNumber: team.number,
    activeEventKey: null,
    teams: [],
    matches: [],
    matchScouting: [],
    pitScouting: [],
    pickList: [],
    ops: {},
  };
}

/**
 * Give a brand-new team its whole spreadsheet straight after the team is created: named the
 * standard way, every table tab with its header row, the Tables catalog, the Summary formulas
 * and the database layout, before anyone has signed in. There is no team data yet, so nothing
 * is read from Postgres. The content stamp means the first real sync with nothing new skips.
 */
export async function ensureHubSheetForNewTeam(
  team: HubTeam,
  bridge: AppsScriptBridge | null = sheetsHubBridge(),
  now: () => Date = () => new Date(),
): Promise<HubTeamBook | null> {
  if (!bridge) return null;
  try {
    const book = await bridge.ensureTeamBook(team);
    const built = buildAllTables(emptyTeamSource(team), now());
    const hash = contentHash(built);
    const { outcomes } = await writeTablesToCopy(new AppsScriptTarget(bridge, team), withMirrorInfo(built, hash, ["google"]), {
      describe: describeGoogleError,
      isFatal: (error) => isGoogleSheetsError(error) && error.kind === "auth_expired",
      throttle: (error) => (isGoogleSheetsError(error) && error.kind === "throttled" ? (error.retryAfterMs ?? 0) : null),
    });
    if (summarizeOutcomes(outcomes).status !== "succeeded") return book;
    await bridge.stampTeamBook(team, hash, built.map((table) => table.spec.sheet));
    return { ...book, lastHash: hash, lastSyncAt: now().toISOString() };
  } catch {
    return null;
  }
}
