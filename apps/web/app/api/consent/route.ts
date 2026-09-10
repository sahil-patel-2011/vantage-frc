import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseConsentAction, summarizeConsent, type FormType, type RecordStatus } from "../../../lib/consent";

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
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Consent request failed" }, { status });
}

type FormRow = { id: string; seasonYear: number; name: string; formType: FormType; required: boolean; documentUrl: string | null; notes: string };
type RecordRow = { id: string; formId: string; personName: string; guardianName: string; status: RecordStatus; signedOn: string | null; byName: string | null };

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getFullYear());

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
      if (!row) return { status: "setup_required" as const, message: "Choose your team to track forms." };

      const [forms, records] = await Promise.all([
        client.query<FormRow>(
          `SELECT id, season_year AS "seasonYear", name, form_type AS "formType", required,
                  document_url AS "documentUrl", notes
           FROM consent_forms WHERE org_id = $1 AND season_year = $2 ORDER BY required DESC, name`,
          [row.orgId, seasonYear],
        ),
        client.query<RecordRow>(
          `SELECT r.id, r.form_id AS "formId", r.person_name AS "personName", r.guardian_name AS "guardianName",
                  r.status, r.signed_on::text AS "signedOn", u.name AS "byName"
           FROM consent_records r
           JOIN consent_forms f ON f.id = r.form_id
           LEFT JOIN users u ON u.id = r.recorded_by
           WHERE r.org_id = $1 AND f.season_year = $2 ORDER BY r.person_name, r.created_at DESC`,
          [row.orgId, seasonYear],
        ),
      ]);

      const summary = summarizeConsent({
        forms: forms.rows.map((f) => ({ id: f.id, required: f.required })),
        records: records.rows.map((r) => ({ formId: r.formId, personName: r.personName, status: r.status })),
      });

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        forms: forms.rows,
        records: records.rows,
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
    const action = parseConsentAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "create_form": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO consent_forms (org_id, season_year, name, form_type, required, document_url, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [action.orgId, action.seasonYear, action.name, action.formType, action.required, action.documentUrl, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "delete_form": {
          const deleted = await client.query(`DELETE FROM consent_forms WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this form");
          return { ok: true };
        }
        case "add_record": {
          const form = await client.query(`SELECT 1 FROM consent_forms WHERE id = $1 AND org_id = $2`, [action.formId, action.orgId]);
          if (!form.rowCount) throw new HttpError(404, "Form not found");
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO consent_records (org_id, form_id, person_name, guardian_name, status, signed_on, recorded_by, user_id)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8::uuid) RETURNING id`,
            [
              action.orgId,
              action.formId,
              action.personName,
              action.guardianName,
              action.status,
              action.signedOn,
              userId,
              action.userId,
            ],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "set_record_status": {
          const updated = await client.query(
            `UPDATE consent_records SET status = $1 WHERE id = $2 AND org_id = $3`,
            [action.status, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Record not found");
          return { ok: true };
        }
        case "delete_record": {
          const deleted = await client.query(`DELETE FROM consent_records WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this record");
          return { ok: true };
        }
        default:
          throw new HttpError(400, "Unsupported consent action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
