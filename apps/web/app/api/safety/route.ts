import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { certExpiryStatus, parseSafetyAction, summarizeSafety, type CertType, type IncidentSeverity, type IncidentStatus, type Treatment } from "../../../lib/safety";
import { deleteSafetyIncident, SafetyAuthError } from "../../../lib/safety/authorization";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status =
    error instanceof HttpError || error instanceof SafetyAuthError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Safety request failed" }, { status });
}

type IncidentRow = {
  id: string; title: string; severity: IncidentSeverity; occurredOn: string; location: string; description: string;
  injuredPerson: string; treatment: Treatment; correctiveAction: string; status: IncidentStatus; byName: string | null;
};
type CertRow = { id: string; personName: string; certType: CertType; completedOn: string; expiresOn: string | null; notes: string; byName: string | null };

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; orgName: string; role: string }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );
      const row = membership.rows[0];
      if (!row) return { status: "setup_required" as const, message: "Select a team to track safety." };

      const [incidents, certs] = await Promise.all([
        client.query<IncidentRow>(
          `SELECT i.id, i.title, i.severity, i.occurred_on::text AS "occurredOn", i.location, i.description,
                  i.injured_person AS "injuredPerson", i.treatment, i.corrective_action AS "correctiveAction",
                  i.status, u.name AS "byName"
           FROM safety_incidents i LEFT JOIN users u ON u.id = i.reported_by
           WHERE i.org_id = $1 ORDER BY i.occurred_on DESC, i.created_at DESC`,
          [row.orgId],
        ),
        client.query<CertRow>(
          `SELECT c.id, c.person_name AS "personName", c.cert_type AS "certType", c.completed_on::text AS "completedOn",
                  c.expires_on::text AS "expiresOn", c.notes, u.name AS "byName"
           FROM safety_certifications c LEFT JOIN users u ON u.id = c.recorded_by
           WHERE c.org_id = $1 ORDER BY c.person_name, c.cert_type`,
          [row.orgId],
        ),
      ]);

      const now = new Date();
      const certsWithStatus = certs.rows.map((c) => ({ ...c, expiry: certExpiryStatus(c.expiresOn, now) }));
      const summary = summarizeSafety({
        incidents: incidents.rows.map((i) => ({ severity: i.severity, status: i.status, occurredOn: i.occurredOn })),
        certifications: certs.rows.map((c) => ({ expiresOn: c.expiresOn })),
        now,
      });

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        incidents: incidents.rows,
        certifications: certsWithStatus,
        summary,
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseSafetyAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "log_incident": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO safety_incidents (org_id, title, severity, occurred_on, location, description, injured_person, treatment, corrective_action, reported_by)
             VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [action.orgId, action.title, action.severity, action.occurredOn, action.location, action.description, action.injuredPerson, action.treatment, action.correctiveAction, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "set_incident_status": {
          const updated = await client.query(
            `UPDATE safety_incidents SET status = $1,
               corrective_action = COALESCE($2, corrective_action), updated_at = now()
             WHERE id = $3 AND org_id = $4`,
            [action.status, action.correctiveAction, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Incident not found");
          return { ok: true };
        }
        case "delete_incident": {
          await deleteSafetyIncident(client, {
            orgId: action.orgId,
            incidentId: action.id,
            userId,
          });
          return { ok: true };
        }
        case "add_certification": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO safety_certifications (org_id, person_name, cert_type, completed_on, expires_on, notes, recorded_by)
             VALUES ($1, $2, $3, $4::date, $5::date, $6, $7) RETURNING id`,
            [action.orgId, action.personName, action.certType, action.completedOn, action.expiresOn, action.notes, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "delete_certification": {
          const deleted = await client.query(`DELETE FROM safety_certifications WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this certification");
          return { ok: true };
        }
        default:
          throw new HttpError(400, "Unsupported safety action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
