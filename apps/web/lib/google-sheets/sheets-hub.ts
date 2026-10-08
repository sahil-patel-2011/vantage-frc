/**
 * Team sheets in the platform's own Google Drive ("hub mode").
 *
 * One Apps Script, deployed once by the platform owner as a standalone web app, keeps a
 * spreadsheet for every team in a "VantageFRC" folder of that Google account, each named the
 * same way ("6925 - Team Name - VantageFRC") and opening on an About tab. Vantage writes the same
 * tables the team's own Google/Excel copy gets (lib/microsoft/workbook-schema), then stamps
 * the content hash in the script, so a sync with nothing new costs one small request.
 *
 * Configured by the server, never by a team:
 *   VANTAGE_SHEETS_HUB_SECRET  64 hex characters, the same value as VANTAGE_SECRET in the script
 *   the web app address        registered by the script itself ("Connect to Vantage", stored in
 *                              platform_sheets_hub), or VANTAGE_SHEETS_HUB_URL, which wins if set
 * Without both, every call here reports "not_configured" and nothing else changes.
 *
 * Runs on the caller's withRls client, as an owner or admin of the team (the caller checks
 * that), so it reads exactly what that person could export themselves.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import type { WorkbookSource } from "../microsoft/workbook-schema";
import { loadWorkbookSource } from "../microsoft/workbook-sync";
import { AppsScriptBridge, type HubTeam, type HubTeamBook } from "./apps-script-bridge";
import {
  HUB_REGISTRATION_MAX_AGE_MS,
  hubRegistrationMessage,
  isAppsScriptSecret,
  isAppsScriptUrl,
} from "./apps-script-source";
import { describeGoogleError } from "./google-api";
import { isLocalAcceptanceSignup } from "@vantage/core/public-signup";
import { provisionWorkbooks } from "../provisioning/workbooks";
import type { WorkspaceWorkbookName } from "../provisioning/model";
import { sheetsHubBridge, sheetsHubConfig } from "./hub-config";
export { sheetsHubBridge, sheetsHubConfig, type SheetsHubConfig } from "./hub-config";

/** The address the script registered, or null (not registered, or 0688 not applied yet). */
export async function readRegisteredHubUrl(client: PoolClient): Promise<string | null> {
  return withSavepoint(
    client,
    async () =>
      (await client.query<{ url: string }>(`SELECT url FROM platform_sheets_hub WHERE id = 1`)).rows[0]?.url ?? null,
    null,
  );
}

/** The hub bridge from env or the registered address, read on the caller's withRls client. */
export async function loadSheetsHubBridge(client: PoolClient): Promise<AppsScriptBridge | null> {
  if (!process.env.VANTAGE_SHEETS_HUB_SECRET) return null;
  // A complete environment configuration never needs the legacy SQL registry.
  // Callers still enforce session/team permissions; exports still use SQL data.
  const configured = sheetsHubConfig();
  if (configured) return sheetsHubBridge(configured);
  return sheetsHubBridge(sheetsHubConfig(process.env, await readRegisteredHubUrl(client)));
}

export type HubRegistrationCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Check the address a freshly deployed hub script handed over: a real Apps Script address,
 * signed with this server's hub secret, opened within the last day.
 */
export function verifyHubRegistration(
  input: { url?: unknown; ts?: unknown; sig?: unknown },
  secret: string | undefined,
  now = Date.now(),
): HubRegistrationCheck {
  const key = secret?.trim().toLowerCase() ?? "";
  if (!isAppsScriptSecret(key)) return { ok: false, error: "The server has no hub secret yet." };
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!isAppsScriptUrl(url)) {
    return {
      ok: false,
      error: "That isn't a deployed web app address. Deploy the script as a web app (not a test deployment) and open its /exec address.",
    };
  }
  const ts = Number(input.ts);
  if (!Number.isFinite(ts) || now - ts > HUB_REGISTRATION_MAX_AGE_MS || ts - now > 5 * 60 * 1000) {
    return { ok: false, error: "That link is out of date. Open the script's web app address again and press Connect." };
  }
  const sig = typeof input.sig === "string" ? input.sig.trim().toLowerCase() : "";
  const expected = createHmac("sha256", key).update(hubRegistrationMessage(url, ts)).digest("hex");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return {
      ok: false,
      error: "The script's secret doesn't match this server. Copy the script from this page again, paste it over the old one and deploy a new version.",
    };
  }
  return { ok: true, url };
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
    key: isLocalAcceptanceSignup() ? `test-${orgId}` : orgId,
    ...(isLocalAcceptanceSignup() ? { testRun: orgId } : {}),
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
  | { status: "setup_required" }
  | { status: "unchanged"; book: HubTeamBook }
  | { status: "succeeded" | "partial" | "failed"; book: HubTeamBook | null; rowsWritten: number; error: string | null };

/**
 * Refresh the same five workspace books used by setup. Strict reads prevent an incomplete
 * database export from replacing a good copy. Only changed books are rewritten and verified.
 */
export async function syncTeamToHub(
  client: PoolClient,
  orgId: string,
  options: { force?: boolean; bridge?: AppsScriptBridge | null; now?: () => Date; only?: WorkspaceWorkbookName } = {},
): Promise<HubSyncResult> {
  const bridge = options.bridge === undefined ? await loadSheetsHubBridge(client) : options.bridge;
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

  const setup = (await client.query<{ state: string; verified: boolean; resources: { workbooks?: Record<string, { id: string; hash: string }> } }>(
    "SELECT state,verified_at IS NOT NULL AS verified,resources FROM team_provisioning_jobs WHERE org_id=$1::uuid", [orgId],
  )).rows[0];
  if (setup && (setup.state !== "ready" || !setup.verified)) return { status: "setup_required" };
  let book: HubTeamBook | null = null;
  let rowsWritten = 0;
  let changed = false;
  let verifiedBooks = 0;
  try {
    const source = await loadWorkbookSource(client, orgId, { strict: true });
    await provisionWorkbooks(bridge, team, source, {
      now, force: options.force, only: options.only, verifyUnchanged: false, verifiedResources: setup?.resources?.workbooks,
      onVerified: async (name, resource, outcome) => {
        if (name === "Competition" || options.only) book = outcome.book;
        rowsWritten += outcome.rowsWritten;
        changed ||= outcome.changed;
        verifiedBooks++;
        await client.query(`UPDATE team_provisioning_jobs SET resources=jsonb_set(resources,'{workbooks}',
          COALESCE(resources->'workbooks','{}'::jsonb)||$2::jsonb) WHERE org_id=$1::uuid AND state='ready'`,
        [orgId, JSON.stringify({ [name]: resource })]);
      },
    });
  } catch (error) {
    return { status: verifiedBooks ? "partial" : "failed", book, rowsWritten, error: describeGoogleError(error) };
  }
  if (!changed && book) return { status: "unchanged", book };
  return { status: "succeeded", book, rowsWritten, error: null };
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
 * Legacy administrative entry point. Uses the same five verified books as self-service
 * setup. A partial write never returns a resource as though all setup succeeded.
 */
export async function ensureHubSheetForNewTeam(
  team: HubTeam,
  bridge: AppsScriptBridge | null = sheetsHubBridge(),
  now: () => Date = () => new Date(),
): Promise<HubTeamBook | null> {
  if (!bridge) return null;
  try {
    let competition: HubTeamBook | null = null;
    await provisionWorkbooks(bridge, team, emptyTeamSource(team), {
      now,
      onVerified: async (name, _resource, outcome) => { if (name === "Competition") competition = outcome.book; },
    });
    return competition;
  } catch {
    return null;
  }
}
