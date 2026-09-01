/**
 * GET /api/shooter-table/export — robot-code constants from logged shooter_points.
 *
 * The file is a literal dump of RPM / hood rows for the season. Interpolation stays
 * on the lookup UI; this route never fills a missing flywheel number.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  exportShooterConstants,
  parseShooterExportLanguage,
  shooterExportFileName,
  type LoggedShooterRow,
} from "../../../../lib/shooter-table";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) throw new HttpError(400, "orgId is required");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getFullYear());
    if (!Number.isInteger(seasonYear)) throw new HttpError(400, "seasonYear is required");
    const language = parseShooterExportLanguage(url.searchParams.get("lang"));

    const payload = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query<{ orgId: string }>(
        `SELECT m.org_id AS "orgId"
         FROM memberships m
         WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid
         LIMIT 1`,
        [orgId, session.user.id],
      );
      if (!membership.rows[0]) throw new HttpError(403, "Organization membership required");

      const points = await client.query<LoggedShooterRow>(
        `SELECT distance_ft::float8 AS "distanceFt", rpm::float8 AS "rpm",
                hood_angle::float8 AS "hoodAngle", table_name AS "tableName"
         FROM shooter_points WHERE org_id = $1::uuid AND season_year = $2
         ORDER BY table_name, distance_ft`,
        [orgId, seasonYear],
      );

      const text = exportShooterConstants(points.rows, { seasonYear, language });
      return { text, fileName: shooterExportFileName({ language, seasonYear }) };
    });

    return new Response(payload.text, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${payload.fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : "Shooter table export failed" },
      { status },
    );
  }
}
