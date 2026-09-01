import type { PoolClient } from "@neondatabase/serverless";
import type { ChatAdapter } from "@vantage/agent";
import { randomUUID } from "node:crypto";

const DREAM_PROMPT = `You are the overnight memory consolidator for a FIRST Robotics Competition team using Vantage.
Given today's team activity log, extract durable facts the team should remember tomorrow.
Rules:
- Only facts grounded in the log. Never invent metrics, match results, or team numbers.
- Prefer operational decisions, pit issues fixed, scouting conclusions, alliance strategy, CAD/mechanical blockers.
- Skip greetings, typos, and ephemeral chatter.
- Return JSON only: {"memories":["...", "..."]} with 0-8 concise bullets (each 12-220 chars).
- If nothing worth remembering, return {"memories":[]}.`;

export type MemoryDreamInput = {
  orgId: string;
  dayKey: string;
  activityLog: string;
};

export type MemoryDreamResult = {
  memories: string[];
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
};

export function parseDreamMemories(raw: string): string[] {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as { memories?: unknown };
    if (!Array.isArray(parsed.memories)) return [];
    return parsed.memories
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length >= 12 && item.length <= 500);
  } catch {
    return [];
  }
}

export async function runMemoryDream(
  adapter: ChatAdapter,
  input: MemoryDreamInput,
): Promise<MemoryDreamResult> {
  const userBlock =
    input.activityLog.trim().length > 0
      ? `${DREAM_PROMPT}\n\nDay: ${input.dayKey}\n\nActivity log:\n${input.activityLog}`
      : `${DREAM_PROMPT}\n\nDay: ${input.dayKey}\n\nActivity log: (empty — return {"memories":[]})`;

  const result = await adapter.complete({
    message: userBlock,
    context: [],
  });

  return {
    memories: parseDreamMemories(result.text),
    model: adapter.model,
    provider: adapter.provider,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  };
}

export async function loadOrgDreamActivity(
  client: PoolClient,
  orgId: string,
  dayKey: string,
): Promise<{ activityLog: string; promotedBy: string | null }> {
  const owner = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId"
     FROM memberships
     WHERE org_id = $1 AND role = 'owner'
     ORDER BY created_at
     LIMIT 1`,
    [orgId],
  );
  const promotedBy = owner.rows[0]?.userId ?? null;

  const sections: string[] = [];

  const messages = await client.query<{ role: string; content: string; createdAt: string }>(
    `SELECT m.role, m.content, m.created_at::text AS "createdAt"
     FROM agent_messages m
     JOIN agent_threads t ON t.id = m.thread_id
     WHERE m.org_id = $1
       AND t.scope = 'team'
       AND m.explicitly_shared = true
       AND m.created_at >= $2::date
       AND m.created_at < ($2::date + interval '1 day')
     ORDER BY m.created_at
     LIMIT 120`,
    [orgId, dayKey],
  );
  if (messages.rows.length) {
    sections.push(
      "Team chat (shared):\n" +
        messages.rows
          .map((row) => `[${row.createdAt}] ${row.role}: ${row.content.slice(0, 600)}`)
          .join("\n"),
    );
  }

  const notes = await client.query<{ content: string; crewRole: string | null }>(
    `SELECT content, crew_role AS "crewRole"
     FROM org_team_context_notes
     WHERE org_id = $1
       AND disabled_at IS NULL
       AND created_at >= $2::date
       AND created_at < ($2::date + interval '1 day')
     ORDER BY created_at
     LIMIT 40`,
    [orgId, dayKey],
  );
  if (notes.rows.length) {
    sections.push(
      "Team context notes:\n" +
        notes.rows
          .map((row) => (row.crewRole ? `[${row.crewRole}] ${row.content}` : row.content))
          .join("\n"),
    );
  }

  const brief = await client.query<{ summary: string }>(
    `SELECT summary
     FROM overnight_intel_briefs
     WHERE org_id = $1 AND brief_date = $2::date
     ORDER BY created_at DESC
     LIMIT 1`,
    [orgId, dayKey],
  );
  if (brief.rows[0]?.summary) {
    sections.push(`Overnight intel brief:\n${brief.rows[0].summary.slice(0, 2000)}`);
  }

  return { activityLog: sections.join("\n\n"), promotedBy };
}

export async function persistDreamMemories(
  client: PoolClient,
  input: {
    orgId: string;
    promotedBy: string;
    memories: string[];
    dayKey: string;
    sourceThreadId?: string | null;
  },
): Promise<string[]> {
  const inserted: string[] = [];
  for (const content of input.memories) {
    const threadId = input.sourceThreadId;
    if (!threadId) {
      const thread = await client.query<{ id: string }>(
        `INSERT INTO agent_threads(org_id, created_by, scope, title)
         VALUES ($1, $2, 'team', $3)
         RETURNING id`,
        [input.orgId, input.promotedBy, `Memory dream ${input.dayKey}`],
      );
      const newThreadId = thread.rows[0]?.id;
      if (!newThreadId) continue;
      const message = await client.query<{ id: string }>(
        `INSERT INTO agent_messages(thread_id, org_id, author_user_id, role, content, explicitly_shared)
         VALUES ($1, $2, $3, 'assistant', $4, true)
         RETURNING id`,
        [newThreadId, input.orgId, input.promotedBy, content],
      );
      const messageId = message.rows[0]?.id;
      if (!messageId) continue;
      const memory = await client.query<{ id: string }>(
        `INSERT INTO team_memories(org_id, content, source_thread_id, source_message_id, promoted_by, importance)
         VALUES ($1, $2, $3, $4, $5, 0.72)
         RETURNING id`,
        [input.orgId, content, newThreadId, messageId, input.promotedBy],
      );
      if (memory.rows[0]?.id) inserted.push(memory.rows[0].id);
    } else {
      const memory = await client.query<{ id: string }>(
        `INSERT INTO team_memories(org_id, content, source_thread_id, promoted_by, importance)
         VALUES ($1, $2, $3, $4, 0.72)
         RETURNING id`,
        [input.orgId, content, threadId, input.promotedBy],
      );
      if (memory.rows[0]?.id) inserted.push(memory.rows[0].id);
    }
  }
  return inserted;
}

export async function runMemoryDreamJob(
  client: PoolClient,
  adapter: ChatAdapter,
  orgId: string,
  dayKey: string,
): Promise<MemoryDreamResult & { memoryIds: string[]; skipped?: boolean; reason?: string }> {
  const settings = await client.query<{ enabled: boolean }>(
    `SELECT enabled FROM team_memory_settings WHERE org_id = $1`,
    [orgId],
  );
  if (settings.rows[0] && !settings.rows[0].enabled) {
    return {
      memories: [],
      memoryIds: [],
      model: "skipped",
      provider: "vantage",
      promptTokens: 0,
      completionTokens: 0,
      skipped: true,
      reason: "team_memory_disabled",
    };
  }

  const { activityLog, promotedBy } = await loadOrgDreamActivity(client, orgId, dayKey);
  if (!activityLog.trim()) {
    return {
      memories: [],
      memoryIds: [],
      model: "skipped",
      provider: "vantage",
      promptTokens: 0,
      completionTokens: 0,
      skipped: true,
      reason: "no_activity",
    };
  }
  if (!promotedBy) {
    throw new Error("Organization has no owner to attribute dream memories");
  }

  const dream = await runMemoryDream(adapter, { orgId, dayKey, activityLog });
  const memoryIds = await persistDreamMemories(client, {
    orgId,
    promotedBy,
    memories: dream.memories,
    dayKey,
  });

  await client.query(
    `INSERT INTO ai_usage_events
      (org_id, user_id, feature, model, provider, key_source, prompt_tokens,
       completion_tokens, total_tokens, cost_usd, request_id, metadata)
     VALUES ($1,$2,'memory_dream',$3,$4,'local_cli',$5,$6,$7,0,$8,$9::jsonb)`,
    [
      orgId,
      promotedBy,
      dream.model,
      dream.provider,
      dream.promptTokens,
      dream.completionTokens,
      dream.promptTokens + dream.completionTokens,
      `memory-dream-${randomUUID()}`,
      JSON.stringify({ dayKey, memoryCount: dream.memories.length, path: "free_relay" }),
    ],
  );

  return { ...dream, memoryIds };
}
