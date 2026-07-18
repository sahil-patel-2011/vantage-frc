import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { streamCsv } from "./csv";
import { buildTextPdf } from "./pdf";
import {
  createExportRegistry,
  EXPORT_CATEGORY_LABELS,
  EXPORT_EXCLUSIONS,
  type ExportFilters,
  type ExportScope,
} from "./registry";

export * from "./csv";
export * from "./pdf";
export * from "./registry";

function key() {
  return createHash("sha256")
    .update(process.env.EXPORT_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET ?? "local-export-key")
    .digest();
}

function encrypt(data: Uint8Array) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(value: string) {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data) throw new Error("Invalid export archive");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return new Uint8Array(Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]));
}

export async function assertExportScope(
  client: PoolClient,
  input: { orgId: string; userId: string; scope: ExportScope },
) {
  if (input.scope === "private") return;
  const membership = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid`,
    [input.orgId, input.userId],
  );
  const role = membership.rows[0]?.role;
  if (!role || !["owner", "admin"].includes(role)) {
    throw new Error("Team exports require organization owner or admin access");
  }
}

function buildProvenanceText(manifest: {
  generatedAt: string;
  scope: ExportScope;
  files: Array<{ name: string; domain: string; category: string; provenance: string }>;
}) {
  const lines = [
    "Vantage export provenance",
    `Generated (UTC): ${manifest.generatedAt}`,
    `Scope: ${manifest.scope}`,
    "",
    "Excluded by policy:",
    ...EXPORT_EXCLUSIONS.map((item) => `- ${item}`),
    "",
    "Files:",
    ...manifest.files.map((file) => `- ${file.name} [${file.category}] ${file.provenance}`),
  ];
  return lines.join("\n");
}

export async function createExportJob(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    scope: ExportScope;
    domains: string[] | "all";
    filters?: ExportFilters;
    reason?: string;
  },
) {
  await assertExportScope(client, { orgId: input.orgId, userId: input.userId, scope: input.scope });
  const recent = await client.query(
    `SELECT count(*)::int AS count FROM export_jobs WHERE requested_by=$1 AND created_at>now()-interval '1 hour'`,
    [input.userId],
  );
  if (Number(recent.rows[0]?.count ?? 0) >= 5) throw new Error("Export rate limit reached; try again later");
  const registry = createExportRegistry();
  const domains =
    input.domains === "all"
      ? [...registry.values()].filter((item) => item.scope === input.scope).map((item) => item.id)
      : [...new Set(input.domains)];
  if (!domains.length) throw new Error("Select at least one export");
  for (const id of domains) {
    const adapter = registry.get(id);
    if (!adapter || adapter.scope !== input.scope) {
      throw new Error(`Export domain is not authorized for ${input.scope} scope: ${id}`);
    }
  }
  const job = await client.query<{ id: string }>(
    `INSERT INTO export_jobs(org_id,requested_by,scope,domains,filters) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id`,
    [input.orgId, input.userId, input.scope, domains, JSON.stringify(input.filters ?? {})],
  );
  await client.query(
    `INSERT INTO export_audit_events(org_id,job_id,actor_user_id,action,reason,metadata) VALUES($1,$2,$3,'export.requested',$4,$5::jsonb)`,
    [input.orgId, job.rows[0]!.id, input.userId, input.reason ?? null, JSON.stringify({ scope: input.scope, domains })],
  );
  return job.rows[0]!.id;
}

export async function exportDomainCsv(
  client: PoolClient,
  input: { orgId: string; userId: string; scope: ExportScope; domain: string; filters?: ExportFilters },
) {
  await assertExportScope(client, { orgId: input.orgId, userId: input.userId, scope: input.scope });
  const registry = createExportRegistry();
  const adapter = registry.get(input.domain);
  if (!adapter || adapter.scope !== input.scope) throw new Error("Export domain is not authorized for this scope");
  let csv = "";
  for await (const chunk of streamCsv(
    adapter.columns,
    adapter.rows({
      client,
      orgId: input.orgId,
      userId: input.userId,
      scope: input.scope,
      filters: input.filters ?? {},
    }),
    { excelBom: input.filters?.excelBom },
  )) {
    csv += chunk;
  }
  await client.query(
    `INSERT INTO export_audit_events(org_id,actor_user_id,action,metadata) VALUES($1,$2,'export.csv',$3::jsonb)`,
    [input.orgId, input.userId, JSON.stringify({ domain: adapter.id, scope: input.scope })],
  );
  return { csv, fileName: adapter.fileName, provenance: adapter.provenance };
}

export async function exportInventoryPdf(
  client: PoolClient,
  input: { orgId: string; userId: string; scope: ExportScope; filters?: ExportFilters },
) {
  await assertExportScope(client, { orgId: input.orgId, userId: input.userId, scope: input.scope });
  const registry = createExportRegistry();
  const adapters = [...registry.values()].filter((item) => item.scope === input.scope);
  const generatedAt = new Date().toISOString();
  const lines = [
    `Organization: ${input.orgId}`,
    `Scope: ${input.scope}`,
    `Event filter: ${input.filters?.eventKey ?? "none"}`,
    "",
    "Domains available for export:",
    ...adapters.map(
      (adapter) =>
        `[${EXPORT_CATEGORY_LABELS[adapter.category]}] ${adapter.fileName} — ${adapter.description} (${adapter.provenance})`,
    ),
    "",
    "Policy exclusions:",
    ...EXPORT_EXCLUSIONS.map((item) => `- ${item}`),
  ];
  const pdf = buildTextPdf({
    title: "Vantage export inventory",
    subtitle: `${input.scope} scope · ${generatedAt}`,
    lines,
    footer: "Vantage audited export center",
  });
  await client.query(
    `INSERT INTO export_audit_events(org_id,actor_user_id,action,metadata) VALUES($1,$2,'export.pdf',$3::jsonb)`,
    [input.orgId, input.userId, JSON.stringify({ scope: input.scope, domainCount: adapters.length })],
  );
  return pdf;
}

export async function processExportJob(client: PoolClient, jobId: string) {
  const result = await client.query<{
    org_id: string;
    requested_by: string;
    scope: ExportScope;
    domains: string[];
    filters: ExportFilters;
  }>(
    `UPDATE export_jobs SET status='running',progress=1,updated_at=now() WHERE id=$1 AND status='queued' RETURNING org_id,requested_by,scope,domains,filters`,
    [jobId],
  );
  const job = result.rows[0];
  if (!job) return;
  try {
    const registry = createExportRegistry();
    const files: Record<string, Uint8Array> = {};
    const generatedAt = new Date().toISOString();
    const manifest: {
      format: string;
      version: number;
      generatedAt: string;
      timezone: string;
      scope: ExportScope;
      categoryLabels: typeof EXPORT_CATEGORY_LABELS;
      exclusions: readonly string[];
      files: Array<{
        name: string;
        domain: string;
        description: string;
        columns: string[];
        category: string;
        provenance: string;
      }>;
    } = {
      format: "Vantage Team Data Export",
      version: 2,
      generatedAt,
      timezone: "UTC",
      scope: job.scope,
      categoryLabels: EXPORT_CATEGORY_LABELS,
      exclusions: EXPORT_EXCLUSIONS,
      files: [],
    };
    for (let index = 0; index < job.domains.length; index++) {
      const cancelled = await client.query(`SELECT cancel_requested_at FROM export_jobs WHERE id=$1`, [jobId]);
      if (cancelled.rows[0]?.cancel_requested_at) {
        await client.query(`UPDATE export_jobs SET status='cancelled',progress=0,updated_at=now() WHERE id=$1`, [jobId]);
        return;
      }
      const adapter = registry.get(job.domains[index]!);
      if (!adapter || adapter.scope !== job.scope) throw new Error("Export adapter authorization changed");
      let csv = "";
      for await (const chunk of streamCsv(
        adapter.columns,
        adapter.rows({ client, orgId: job.org_id, userId: job.requested_by, scope: job.scope, filters: job.filters }),
        { excelBom: job.filters.excelBom },
      )) {
        csv += chunk;
      }
      files[adapter.fileName] = strToU8(csv);
      manifest.files.push({
        name: adapter.fileName,
        domain: adapter.id,
        description: adapter.description,
        columns: adapter.columns,
        category: adapter.category,
        provenance: adapter.provenance,
      });
      await client.query(`UPDATE export_jobs SET progress=$2,updated_at=now() WHERE id=$1`, [
        jobId,
        Math.max(1, Math.floor(((index + 1) / job.domains.length) * 90)),
      ]);
    }
    files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
    files["PROVENANCE.txt"] = strToU8(buildProvenanceText(manifest));
    const archive = zipSync(files, { level: 6 });
    await client.query(
      `UPDATE export_jobs SET status='completed',progress=100,encrypted_archive=$2,expires_at=now()+interval '24 hours',size_bytes=$3,completed_at=now(),updated_at=now() WHERE id=$1`,
      [jobId, encrypt(archive), archive.byteLength],
    );
    await client.query(
      `INSERT INTO export_audit_events(org_id,job_id,actor_user_id,action,metadata) VALUES($1,$2,$3,'export.completed',$4::jsonb)`,
      [
        job.org_id,
        jobId,
        job.requested_by,
        JSON.stringify({ sizeBytes: archive.byteLength, fileCount: manifest.files.length, manifestVersion: 2 }),
      ],
    );
    await client.query(
      `INSERT INTO notifications(user_id,org_id,type,payload) SELECT $1,$2,'export_ready',$3::jsonb WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id=$1 AND type='export_ready' AND payload->>'jobId'=$4)`,
      [
        job.requested_by,
        job.org_id,
        JSON.stringify({
          title: "Team export ready",
          body: "Your private export archive is available for 24 hours.",
          href: `/exports?orgId=${job.org_id}`,
          jobId,
        }),
        jobId,
      ],
    );
  } catch (error) {
    await client.query(`UPDATE export_jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1`, [
      jobId,
      error instanceof Error ? error.message : "Export failed",
    ]);
    throw error;
  }
}

export async function downloadExport(client: PoolClient, token: string) {
  const hash = createHash("sha256").update(token).digest("hex");
  const result = await client.query<{ id: string; encrypted_archive: string; requested_by: string; org_id: string }>(
    `SELECT id,encrypted_archive,requested_by,org_id FROM export_jobs WHERE download_token_hash=$1 AND status='completed' AND expires_at>now()`,
    [hash],
  );
  const job = result.rows[0];
  if (!job) throw new Error("Export link is invalid or expired");
  await client.query(`INSERT INTO export_audit_events(org_id,job_id,actor_user_id,action) VALUES($1,$2,$3,'export.downloaded')`, [
    job.org_id,
    job.id,
    job.requested_by,
  ]);
  return decrypt(job.encrypted_archive);
}

export async function issueExportDownload(client: PoolClient, jobId: string, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const result = await client.query(
    `UPDATE export_jobs SET download_token_hash=$3 WHERE id=$1 AND requested_by=$2 AND status='completed' AND expires_at>now() RETURNING id`,
    [jobId, userId, hash],
  );
  if (!result.rowCount) throw new Error("Completed export is unavailable");
  return token;
}

export async function expireExports(client: PoolClient) {
  return client.query(
    `UPDATE export_jobs SET status='expired',encrypted_archive=NULL,download_token_hash=NULL,updated_at=now() WHERE expires_at<=now() AND encrypted_archive IS NOT NULL`,
  );
}

export function inspectExportManifest(archive: Uint8Array) {
  const files = unzipSync(archive);
  if (!files["manifest.json"]) throw new Error("Export manifest missing");
  return JSON.parse(strFromU8(files["manifest.json"])) as unknown;
}