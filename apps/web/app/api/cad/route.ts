import { randomUUID } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import {
  buildDefaultCadPlan,
  CadRepository,
  DeterministicMockCadAdapter,
  type CadAction,
  type EngineeringBrief,
} from "@vantage/cad";
import type { ContextSource } from "@vantage/agent";
import { headers } from "next/headers";

async function current() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "CAD request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const jobId = url.searchParams.get("jobId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const jobs = await client.query(
        `SELECT id,title,platform,execution_mode AS "executionMode",status,brief,brief_confirmed_at AS "briefConfirmedAt",current_checkpoint_id AS "currentCheckpointId",updated_at AS "updatedAt" FROM cad_jobs WHERE org_id=$1 ORDER BY updated_at DESC LIMIT 30`,
        [orgId],
      );
      const detail = jobId
        ? {
            steps: (
              await client.query(
                `SELECT id,sequence,operation,parameters,status,requires_approval AS "requiresApproval",approval_status AS "approvalStatus",progress,output,error FROM cad_job_steps WHERE org_id=$1 AND job_id=$2 ORDER BY sequence`,
                [orgId, jobId],
              )
            ).rows,
            artifacts: (
              await client.query(
                `SELECT id,type,title,version,content,checksum,created_at AS "createdAt" FROM cad_artifacts WHERE org_id=$1 AND job_id=$2 ORDER BY created_at DESC`,
                [orgId, jobId],
              )
            ).rows,
            checkpoints: (
              await client.query(
                `SELECT id,external_version_ref AS "externalVersionRef",topology,human_edit_detected AS "humanEditDetected",created_at AS "createdAt" FROM cad_checkpoints WHERE org_id=$1 AND job_id=$2 ORDER BY created_at DESC`,
                [orgId, jobId],
              )
            ).rows,
          }
        : null;
      const devices = await client.query(
        `SELECT id,machine_name AS "machineName",platform,status,cli_version AS "cliVersion",last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt" FROM cad_relay_devices WHERE org_id=$1 ORDER BY created_at DESC`,
        [orgId],
      );
      return {
        jobs: jobs.rows,
        detail,
        devices: devices.rows,
        mechanisms: (
          await client.query(
            `SELECT id,name,category,description,version,updated_at AS "updatedAt" FROM cad_mechanisms WHERE org_id=$1 ORDER BY category,name`,
            [orgId],
          )
        ).rows,
      };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
      const repository = new CadRepository(client);
      const action = String(body.action ?? "");
      if (action === "brief") {
        const teamKey = String(body.teamKey ?? "");
        const sources: ContextSource[] = [];
        if (teamKey) {
          const metrics = (
            await client.query(
              `SELECT team_key,event_key,epa_total,epa_auto,epa_teleop,epa_endgame,rank,wins,losses,ties,source,synced_at FROM team_event_metrics WHERE team_key=$1 ORDER BY synced_at DESC LIMIT 6`,
              [teamKey],
            )
          ).rows;
          metrics.forEach((value, index) =>
            sources.push({
              type: "module_data",
              id: `metric:${teamKey}:${index}`,
              content: JSON.stringify(value),
              importance: 1,
              classification: "hard_metric",
            }),
          );
          const scouting = (
            await client.query(
              `SELECT id,payload,confidence,match_key,created_at FROM match_scout_entries WHERE org_id=$1 AND team_key=$2 ORDER BY created_at DESC LIMIT 12`,
              [orgId, teamKey],
            )
          ).rows;
          scouting.forEach((value) =>
            sources.push({
              type: "module_data",
              id: String(value.id),
              content: JSON.stringify(value),
              importance: 0.9,
              classification: "scout_observation",
            }),
          );
          const findings = (
            await client.query(
              `SELECT id,summary,confidence,source_url,found_at FROM research_findings WHERE team_key=$1 ORDER BY found_at DESC LIMIT 8`,
              [teamKey],
            )
          ).rows;
          findings.forEach((value) =>
            sources.push({
              type: "module_data",
              id: String(value.id),
              content: String(value.summary),
              importance: Number(value.confidence),
              classification: "researched_claim",
              sourceUrl: String(value.source_url),
              observedAt: new Date(String(value.found_at)).toISOString(),
            }),
          );
        }
        return repository.createBriefJob({
          orgId,
          userId: session.user.id,
          threadId: body.threadId ? String(body.threadId) : undefined,
          requestId: randomUUID(),
          title: String(body.title ?? "Engineering concept"),
          request: String(body.request ?? ""),
          sources,
          platform: (body.platform ?? "mock") as "onshape" | "fusion360" | "mock",
          executionMode: (body.executionMode ?? "hosted") as "hosted" | "local",
        });
      }
      if (action === "confirm")
        return repository.confirmBrief(orgId, String(body.jobId), session.user.id, body.brief as EngineeringBrief);
      if (action === "plan")
        return repository.savePlan(orgId, String(body.jobId), session.user.id, body.actions as CadAction[]);
      if (action === "plan-default") {
        const job = (
          await client.query<{ brief: EngineeringBrief }>(
            `SELECT brief FROM cad_jobs WHERE id=$1 AND org_id=$2 AND brief_confirmed_at IS NOT NULL`,
            [body.jobId, orgId],
          )
        ).rows[0];
        if (!job) throw new Error("Confirm the engineering brief before planning");
        const plan = buildDefaultCadPlan(job.brief, { autoRunVerify: Boolean(body.autoRunVerify) });
        await repository.savePlan(orgId, String(body.jobId), session.user.id, plan);
        return { actions: plan };
      }
      if (action === "approve")
        return repository.approveStep(
          orgId,
          String(body.jobId),
          String(body.stepId),
          session.user.id,
          Boolean(body.approved),
        );
      if (action === "execute-mock")
        return repository.executeStep(
          orgId,
          String(body.jobId),
          String(body.stepId),
          session.user.id,
          new DeterministicMockCadAdapter(),
        );
      if (action === "execute-api-stub") {
        const executed = await repository.executeStep(
          orgId,
          String(body.jobId),
          String(body.stepId),
          session.user.id,
          new DeterministicMockCadAdapter(),
        );
        const brainMode = String(body.brainMode ?? "managed_api");
        const keySource = brainMode === "terminal_cli" ? "local_cli" : brainMode === "team_byok" ? "byo" : "platform";
        await client.query(
          `INSERT INTO ai_usage_events
            (org_id, user_id, feature, model, provider, key_source, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_id, metadata)
           VALUES ($1,$2,'cad',$3,$4,$5,0,0,0,0,$6,$7::jsonb)`,
          [
            orgId,
            session.user.id,
            "cad-api-stub-v1",
            "vantage-cad",
            keySource,
            randomUUID(),
            JSON.stringify({
              brainMode,
              note:
                keySource === "local_cli"
                  ? "Terminal CLI path — no Vantage model charge"
                  : "API path stub until live CAD model routing is enabled",
            }),
          ],
        );
        return { ...executed, keySource, costUsd: 0 };
      }
      if (action === "cancel") {
        await client.query(
          `UPDATE cad_jobs SET cancel_requested_at=now(),status='cancelled',updated_at=now() WHERE id=$1 AND org_id=$2 AND created_by=$3`,
          [body.jobId, orgId, session.user.id],
        );
        return { success: true };
      }
      if (action === "revoke-device") {
        await client.query(
          `UPDATE cad_relay_devices SET revoked_at=now(),status='revoked',updated_at=now() WHERE id=$1 AND org_id=$2 AND (user_id=$3 OR has_org_role($2,ARRAY['owner','admin']::org_role[]))`,
          [body.deviceId, orgId, session.user.id],
        );
        return { success: true };
      }
      throw new Error("Invalid CAD action");
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
