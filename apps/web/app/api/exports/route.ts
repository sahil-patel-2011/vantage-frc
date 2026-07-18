import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import {
  createExportJob,
  createExportRegistry,
  exportDomainCsv,
  exportInventoryPdf,
  issueExportDownload,
  processExportJob,
  type ExportFilters,
  type ExportScope,
} from "@vantage/export-center";
import { after } from "next/server";
import { headers } from "next/headers";

async function current() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const errorResponse = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Export request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const jobs = await withRls({ userId: session.user.id, orgId }, async (client) =>
      (
        await client.query(
          `SELECT id,scope,status,domains,filters,progress,size_bytes AS "sizeBytes",error,expires_at AS "expiresAt",created_at AS "createdAt" FROM export_jobs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 30`,
          [orgId],
        )
      ).rows,
    );
    return Response.json({
      jobs,
      domains: [...createExportRegistry().values()].map(({ id, description, scope, fileName, category, provenance }) => ({
        id,
        description,
        scope,
        fileName,
        category,
        provenance,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type ExportPostBody = {
  orgId: string;
  scope: ExportScope;
  domains: string[] | "all";
  domain?: string;
  filters?: ExportFilters;
  action?: "download" | "csv" | "pdf" | "create";
  jobId?: string;
  reason?: string;
};

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as ExportPostBody;
    const action = body.action ?? "create";

    if (action === "download") {
      const token = await withRls({ userId: session.user.id, orgId: body.orgId }, (client) =>
        issueExportDownload(client, String(body.jobId), session.user.id),
      );
      return Response.json({ url: `/api/exports/download?token=${encodeURIComponent(token)}` });
    }

    if (action === "csv") {
      const domain = body.domain ?? body.domains[0];
      if (!domain || Array.isArray(body.domains) && body.domains.length !== 1 && !body.domain) {
        throw new Error("Select exactly one export domain for CSV download");
      }
      const result = await withRls({ userId: session.user.id, orgId: body.orgId }, (client) =>
        exportDomainCsv(client, {
          orgId: body.orgId,
          userId: session.user.id,
          scope: body.scope,
          domain: String(domain),
          filters: body.filters ?? {},
        }),
      );
      return new Response(result.csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${result.fileName}"`,
          "x-vantage-provenance": result.provenance,
        },
      });
    }

    if (action === "pdf") {
      const pdf = await withRls({ userId: session.user.id, orgId: body.orgId }, (client) =>
        exportInventoryPdf(client, {
          orgId: body.orgId,
          userId: session.user.id,
          scope: body.scope,
          filters: body.filters ?? {},
        }),
      );
      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="vantage-export-inventory.pdf"',
        },
      });
    }

    const jobId = await withRls({ userId: session.user.id, orgId: body.orgId }, (client) =>
      createExportJob(client, {
        orgId: body.orgId,
        userId: session.user.id,
        scope: body.scope,
        domains: body.domains,
        filters: body.filters ?? {},
        reason: body.reason,
      }),
    );
    after(async () => {
      await withRls({ userId: session.user.id, orgId: body.orgId }, (client) => processExportJob(client, jobId));
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as { orgId: string; jobId: string };
    await withRls({ userId: session.user.id, orgId: body.orgId }, (client) =>
      client.query(
        `UPDATE export_jobs SET cancel_requested_at=now(),updated_at=now() WHERE id=$1 AND org_id=$2 AND requested_by=$3 AND status IN ('queued','running')`,
        [body.jobId, body.orgId, session.user.id],
      ),
    );
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}