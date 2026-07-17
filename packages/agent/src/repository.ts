import type { PoolClient } from "@neondatabase/serverless";
import { boundedContext, type ChatAdapter, type ContextItem } from "./index";
import { AIOrchestrator, type ContextSource } from "./orchestrator";
import { createVantageToolRegistry } from "./tools";
import type { AnnotatedToolOutput } from "./auto-tools";

export type SourceRef = {
  type: string;
  id: string;
  classification?: string;
  toolName?: string;
  status?: string;
  summary?: string;
};

export class AgentRepository {
  constructor(private readonly client: PoolClient) {}

  async createThread(userId: string, input: { orgId: string; scope: "private" | "team"; title: string }) {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO agent_threads(org_id,created_by,scope,title) VALUES($1,$2,$3,$4) RETURNING id`,
      [input.orgId, userId, input.scope, input.title.trim()],
    );
    return result.rows[0]!.id;
  }

  async listThreads() {
    return (
      await this.client.query(
        `SELECT id,org_id AS "orgId",scope,title,updated_at AS "updatedAt"
         FROM agent_threads ORDER BY updated_at DESC LIMIT 50`,
      )
    ).rows;
  }

  async getMessages(threadId: string) {
    return (
      await this.client.query(
        `SELECT m.id,m.role,m.content,m.explicitly_shared AS "explicitlyShared",m.provider,m.model,
                m.created_at AS "createdAt",
                u.source_refs AS "sourceRefs",u.token_count AS "tokenCount"
         FROM agent_messages m
         LEFT JOIN LATERAL (
           SELECT source_refs, token_count
           FROM agent_context_usage
           WHERE message_id=m.id
           ORDER BY created_at DESC
           LIMIT 1
         ) u ON true
         WHERE m.thread_id=$1
         ORDER BY m.created_at`,
        [threadId],
      )
    ).rows as Array<{
      id: string;
      role: string;
      content: string;
      explicitlyShared: boolean;
      provider?: string;
      model?: string;
      createdAt: string;
      sourceRefs?: SourceRef[] | null;
      tokenCount?: number | null;
    }>;
  }

  async listUserMemories(userId: string) {
    return (
      await this.client.query(
        `SELECT id,kind,content,importance,disabled_at AS "disabledAt",
          expires_at AS "expiresAt",updated_at AS "updatedAt"
         FROM user_memories WHERE user_id=$1 ORDER BY updated_at DESC`,
        [userId],
      )
    ).rows;
  }

  async getMemorySettings(userId: string, orgId?: string) {
    const privateSettings = await this.client.query<{
      enabled: boolean;
      tokenBudget: number;
    }>(
      `SELECT COALESCE(enabled,true) AS enabled, COALESCE(token_budget,1200) AS "tokenBudget"
       FROM user_memory_settings WHERE user_id=$1`,
      [userId],
    );
    let team: { enabled: boolean; tokenBudget: number; retentionDays: number } | null = null;
    if (orgId) {
      const teamSettings = await this.client.query<{
        enabled: boolean;
        tokenBudget: number;
        retentionDays: number;
      }>(
        `SELECT enabled, token_budget AS "tokenBudget", retention_days AS "retentionDays"
         FROM team_memory_settings WHERE org_id=$1`,
        [orgId],
      );
      team = teamSettings.rows[0] ?? { enabled: false, tokenBudget: 1600, retentionDays: 365 };
    }
    return {
      private: privateSettings.rows[0] ?? { enabled: true, tokenBudget: 1200 },
      team,
    };
  }

  async saveUserMemory(
    userId: string,
    input: { id?: string; kind: string; content: string; importance?: number },
  ) {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO user_memories(id,user_id,kind,content,importance)
       VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,content=excluded.content,
        importance=excluded.importance,updated_at=now()
       RETURNING id`,
      [input.id ?? null, userId, input.kind, input.content.trim(), input.importance ?? 0.5],
    );
    return result.rows[0]!.id;
  }

  async setUserMemoryEnabled(userId: string, enabled: boolean, tokenBudget?: number) {
    await this.client.query(
      `INSERT INTO user_memory_settings(user_id,enabled,token_budget) VALUES($1,$2,COALESCE($3,1200))
       ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,
        token_budget=COALESCE($3,user_memory_settings.token_budget),updated_at=now()`,
      [userId, enabled, tokenBudget ?? null],
    );
  }

  async deleteUserMemory(userId: string, memoryId: string) {
    await this.client.query("DELETE FROM user_memories WHERE id=$1 AND user_id=$2", [memoryId, userId]);
  }

  async setTeamMemory(
    orgId: string,
    userId: string,
    input: { enabled: boolean; retentionDays?: number; tokenBudget?: number },
  ) {
    await this.client.query(
      `INSERT INTO team_memory_settings(org_id,enabled,retention_days,token_budget,updated_by)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(org_id) DO UPDATE SET
        enabled=excluded.enabled,retention_days=excluded.retention_days,
        token_budget=excluded.token_budget,updated_by=excluded.updated_by,updated_at=now()`,
      [orgId, input.enabled, input.retentionDays ?? 365, input.tokenBudget ?? 1600, userId],
    );
  }

  async promoteMessage(orgId: string, userId: string, messageId: string) {
    await this.client.query(
      `UPDATE agent_messages SET explicitly_shared=true WHERE id=$1 AND author_user_id=$2`,
      [messageId, userId],
    );
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO team_memories(org_id,content,source_thread_id,source_message_id,promoted_by)
       SELECT $1,m.content,m.thread_id,m.id,$2 FROM agent_messages m
       WHERE m.id=$3 AND m.author_user_id=$2 AND m.explicitly_shared=true
       RETURNING id`,
      [orgId, userId, messageId],
    );
    if (!result.rows[0]) throw new Error("Only the author can promote this message");
    return result.rows[0].id;
  }

  async retrieveContext(userId: string, orgId?: string) {
    const settings = await this.client.query<{ enabled: boolean; tokenBudget: number }>(
      `SELECT COALESCE(enabled,true) AS enabled, COALESCE(token_budget,1200) AS "tokenBudget"
       FROM user_memory_settings WHERE user_id=$1`,
      [userId],
    );
    const privateEnabled = settings.rows[0]?.enabled ?? true;
    const privateBudget = settings.rows[0]?.tokenBudget ?? 1200;
    const privateResult = await this.client.query<{
      id: string;
      content: string;
      importance: number;
    }>(
      `SELECT m.id,m.content,m.importance
       FROM user_memories m
       WHERE m.user_id=$1 AND m.disabled_at IS NULL
         AND (m.expires_at IS NULL OR m.expires_at>now()) ORDER BY m.importance DESC,m.updated_at DESC`,
      [userId],
    );
    const privateItems: ContextItem[] = privateEnabled
      ? privateResult.rows.map((row) => ({ type: "private_memory", id: row.id, content: row.content, importance: row.importance }))
      : [];
    let teamItems: ContextItem[] = [];
    let teamBudget = 0;
    if (orgId) {
      const team = await this.client.query<{
        id: string;
        content: string;
        importance: number;
        tokenBudget: number;
      }>(
        `SELECT m.id,m.content,m.importance,s.token_budget AS "tokenBudget"
         FROM team_memory_settings s JOIN team_memories m ON m.org_id=s.org_id
         WHERE s.org_id=$1 AND s.enabled=true AND m.disabled_at IS NULL
           AND (m.expires_at IS NULL OR m.expires_at>now())
         ORDER BY m.importance DESC,m.updated_at DESC`,
        [orgId],
      );
      teamBudget = team.rows[0]?.tokenBudget ?? 0;
      teamItems = team.rows.map((row) => ({ type: "team_memory", id: row.id, content: row.content, importance: row.importance }));
    }
    const privateBounded = boundedContext(privateItems, privateBudget);
    const teamBounded = boundedContext(teamItems, teamBudget);
    return {
      items: [...privateBounded.items, ...teamBounded.items],
      estimatedTokens: privateBounded.estimatedTokens + teamBounded.estimatedTokens,
    };
  }

  async sendMessage(input: {
    userId: string;
    orgId: string;
    threadId: string;
    message: string;
    scope: "private" | "team";
    adapter: ChatAdapter;
    requestId: string;
    selected?: { teamKey?: string; matchKey?: string };
  }) {
    const message = await this.client.query<{ id: string }>(
      `INSERT INTO agent_messages(thread_id,org_id,author_user_id,role,content,explicitly_shared)
       VALUES($1,$2,$3,'user',$4,$5) RETURNING id`,
      [input.threadId, input.orgId, input.userId, input.message, input.scope === "team"],
    );
    const context = await this.retrieveContext(input.userId, input.scope === "team" ? input.orgId : undefined);
    const orchestrated = await new AIOrchestrator(this.client, createVantageToolRegistry()).run({
      orgId: input.orgId,
      userId: input.userId,
      threadId: input.threadId,
      requestId: input.requestId,
      capability: "chat",
      privacyScope: input.scope,
      message: input.message,
      adapter: input.adapter,
      selected: input.selected,
      autoTools: true,
      contextSources: context.items.map(
        (item) =>
          ({
            ...item,
            classification: item.type === "private_memory" ? "private_memory" : "team_memory",
          }) as ContextSource,
      ),
      tokenBudget: context.estimatedTokens + 1000,
    });
    const text = orchestrated.text;
    const assistant = await this.client.query<{ id: string }>(
      `INSERT INTO agent_messages(thread_id,org_id,role,content,explicitly_shared,provider,model)
       VALUES($1,$2,'assistant',$3,$4,$5,$6) RETURNING id`,
      [input.threadId, input.orgId, text, input.scope === "team", input.adapter.provider, input.adapter.model],
    );
    const sourceRefs: SourceRef[] = [
      ...context.items.map((item) => ({ type: item.type, id: item.id })),
      ...orchestrated.toolOutputs.map((tool: AnnotatedToolOutput, index: number) => ({
        type: "module_fact",
        id: `${tool.name}:${index}`,
        classification: tool.classification,
        toolName: tool.name,
        status: tool.status,
        summary: tool.summary,
      })),
    ];
    await this.client.query(
      `INSERT INTO agent_context_usage(thread_id,message_id,user_id,org_id,source_refs,token_count)
       VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        input.threadId,
        assistant.rows[0]!.id,
        input.userId,
        input.orgId ?? null,
        JSON.stringify(sourceRefs),
        context.estimatedTokens +
          orchestrated.toolOutputs.reduce((sum, tool) => sum + Math.ceil(JSON.stringify(tool.output).length / 4), 0),
      ],
    );
    return {
      messageId: message.rows[0]!.id,
      assistantId: assistant.rows[0]!.id,
      text,
      runId: orchestrated.runId,
      contextSources: orchestrated.contextSources,
      toolOutputs: orchestrated.toolOutputs,
      activeEventKey: orchestrated.activeEventKey,
      usageFeature: orchestrated.usageFeature,
    };
  }
}
