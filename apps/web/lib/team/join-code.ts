import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
} from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";

export function validTeamPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}
export function newTeamPin() {
  return String(randomInt(1_000_000)).padStart(6, "0");
}
function encryptionKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new Error(
      "Join codes are unavailable until server authentication is configured.",
    );
  return createHash("sha256")
    .update(`vantage:team-join-code:v1:${secret}`)
    .digest();
}
export function encryptTeamPin(pin: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const bytes = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function decryptTeamPin(value: string) {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data)
    throw new Error("Join code could not be read. Generate a new one.");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}
export async function assertJoinCodeManager(client: PoolClient, orgId: string) {
  const permission = await client.query<{ allowed: boolean }>(
    "SELECT has_org_capability($1,'manage_members') AS allowed",
    [orgId],
  );
  if (!permission.rows[0]?.allowed)
    throw new Error(
      "Only the team owner, mentors and coaches, and people they allow to invite can see or change the join code.",
    );
}

/** The access a team code gives (0721): Parent or guest unless the owner chose Student. */
export type JoinCodeRole = "scout" | "viewer";
export function isJoinCodeRole(value: unknown): value is JoinCodeRole {
  return value === "scout" || value === "viewer";
}

/**
 * Make (or replace) the team's code. `enable` decides whether it works straight away:
 * Team admin's "Turn on" and "New code" pass true; a team's first code, made for it at setup,
 * is created off (QA A3-01: a code on by default let anyone with the number and six digits in).
 * Replacing a code keeps its on/off state unless `enable` says otherwise.
 */
export async function setTeamJoinCode(
  client: PoolClient,
  orgId: string,
  providedPin?: string,
  options: { enable?: boolean; role?: JoinCodeRole } = {},
) {
  let pin = providedPin ?? newTeamPin();
  if (!validTeamPin(pin))
    throw new Error("Use exactly six numbers for the team join code.");
  await assertJoinCodeManager(client, orgId);
  const current = (
    await client.query<{ pin_hash: string; matches: boolean }>(
      "SELECT pin_hash,crypt($2,pin_hash)=pin_hash AS matches FROM team_join_codes WHERE org_id=$1 FOR UPDATE",
      [orgId, pin],
    )
  ).rows[0];
  if (current?.matches && providedPin !== undefined)
    throw new Error(
      "Choose a different code, or leave it blank for a new one.",
    );
  let repeats = current?.matches ?? false;
  while (repeats) {
    pin = newTeamPin();
    repeats = (
      await client.query<{ matches: boolean }>(
        "SELECT crypt($1,$2)=$2 AS matches",
        [pin, current!.pin_hash],
      )
    ).rows[0]!.matches;
  }
  const enable = options.enable ?? true;
  await client.query(
    `INSERT INTO team_join_codes(org_id,pin_hash,encrypted_pin,enabled,join_role)
     VALUES($1,crypt($2,gen_salt('bf',8)),$3,$4::boolean,COALESCE($5::org_role,'viewer'::org_role))
     ON CONFLICT(org_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,encrypted_pin=EXCLUDED.encrypted_pin,
       enabled=$4::boolean OR team_join_codes.enabled,
       join_role=COALESCE($5::org_role,team_join_codes.join_role),updated_at=now()`,
    [orgId, pin, encryptTeamPin(pin), enable, options.role ?? null],
  );
  await client.query(
    "UPDATE invites SET status='revoked' WHERE status='pending' AND id IN (SELECT invite_id FROM team_join_code_invites WHERE org_id=$1)",
    [orgId],
  );
  return pin;
}
