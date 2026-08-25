/**
 * Bugbot finding lifecycle storage (migration 0468).
 *
 * A reviewer only earns trust over a season if a re-scan can say "these three are
 * the ones you already looked at, this one is new, that one is gone". That means
 * findings are rows with a stable fingerprint, not a jsonb blob per run.
 *
 * Everything here runs on the request `PoolClient` from withRls — org isolation is
 * the RLS policy, and every statement is parameterized.
 */
import type { PoolClient } from "@neondatabase/serverless";
import {
  diffBugbotFindings,
  type BugbotFinding,
  type BugbotFindingDelta,
} from "@vantage/agent/bugbot";

export type StoredBugbotFinding = {
  fingerprint: string;
  filePath: string;
  rule: string;
  severity: "high" | "medium" | "low";
  source: "local_rule" | "model";
  finding: string;
  evidence: string;
  line: number;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
};

export type BugbotDismissal = {
  fingerprint: string;
  reason: string;
  filePath: string | null;
  rule: string | null;
  createdAt: string;
};

/** Open (unresolved) findings recorded for this repo scope. */
export async function loadOpenBugbotFindings(
  client: PoolClient,
  orgId: string,
  scopeKey: string,
): Promise<StoredBugbotFinding[]> {
  const result = await client.query<StoredBugbotFinding>(
    `SELECT fingerprint, file_path AS "filePath", rule, severity, source, finding, evidence, line,
            first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", seen_count AS "seenCount"
       FROM code_bugbot_findings
      WHERE org_id = $1::uuid AND scope_key = $2 AND resolved_at IS NULL
      ORDER BY last_seen_at DESC
      LIMIT 500`,
    [orgId, scopeKey],
  );
  return result.rows;
}

export async function loadBugbotDismissals(
  client: PoolClient,
  orgId: string,
  scopeKey: string,
): Promise<BugbotDismissal[]> {
  const result = await client.query<BugbotDismissal>(
    `SELECT fingerprint, reason, file_path AS "filePath", rule, created_at AS "createdAt"
       FROM code_bugbot_finding_dismissals
      WHERE org_id = $1::uuid AND scope_key = $2
      ORDER BY created_at DESC
      LIMIT 300`,
    [orgId, scopeKey],
  );
  return result.rows;
}

export type BugbotDelta = {
  newCount: number;
  knownCount: number;
  fixedCount: number;
  newFingerprints: string[];
  fixedFingerprints: string[];
  /** Findings that were open before and this scan re-read the file, but the evidence is gone. */
  fixed: StoredBugbotFinding[];
};

/**
 * Record this pass's findings and return the NEW / KNOWN / FIXED delta.
 *
 * FIXED is only claimed for files this pass actually read (`reviewedFiles`) — a
 * finding in a file a chunked scan never reached stays open.
 */
export async function recordBugbotFindings(
  client: PoolClient,
  input: {
    orgId: string;
    scopeKey: string;
    reviewId: string | null;
    githubRepo: string | null;
    githubSha: string | null;
    reviewedFiles: string[];
    findings: BugbotFinding[];
  },
): Promise<BugbotDelta> {
  const open = await loadOpenBugbotFindings(client, input.orgId, input.scopeKey);
  const current = input.findings
    .filter((finding) => finding.fingerprint)
    .map((finding) => ({
      fingerprint: finding.fingerprint!,
      filePath: finding.filePath ?? finding.location.split(":")[0] ?? "",
      rule: finding.pattern ?? finding.source,
      severity: finding.severity,
      source: finding.source,
      finding: finding.finding.slice(0, 1000),
      evidence: finding.evidence.slice(0, 400),
      line: Math.max(1, Math.floor(finding.line || 1)),
    }));

  const delta = diffBugbotFindings({
    current,
    known: open.map((row) => ({ fingerprint: row.fingerprint, filePath: row.filePath })),
    reviewedFiles: input.reviewedFiles,
  });

  if (current.length) {
    const columns = 13;
    const values: unknown[] = [];
    const tuples = current.map((item, index) => {
      const base = index * columns;
      values.push(
        input.orgId,
        input.scopeKey,
        item.fingerprint,
        item.rule.slice(0, 120),
        item.filePath.slice(0, 400),
        item.line,
        item.severity,
        item.source,
        item.finding,
        item.evidence,
        input.githubRepo,
        input.githubSha,
        input.reviewId,
      );
      return `($${base + 1}::uuid,$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::int,$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13}::uuid)`;
    });
    await client.query(
      `INSERT INTO code_bugbot_findings
         (org_id, scope_key, fingerprint, rule, file_path, line, severity, source, finding, evidence,
          github_repo, first_seen_sha, first_review_id)
       VALUES ${tuples.join(",")}
       ON CONFLICT (org_id, scope_key, fingerprint) DO UPDATE SET
         line = EXCLUDED.line,
         severity = EXCLUDED.severity,
         finding = EXCLUDED.finding,
         evidence = EXCLUDED.evidence,
         file_path = EXCLUDED.file_path,
         last_seen_at = now(),
         seen_count = code_bugbot_findings.seen_count + 1,
         resolved_at = NULL,
         resolved_sha = NULL`,
      values,
    );
    // last_seen_sha / last_review_id are the same for every row in this pass.
    await client.query(
      `UPDATE code_bugbot_findings
          SET last_seen_sha = $3, last_review_id = $4::uuid
        WHERE org_id = $1::uuid AND scope_key = $2 AND fingerprint = ANY($5::text[])`,
      [
        input.orgId,
        input.scopeKey,
        input.githubSha,
        input.reviewId,
        current.map((item) => item.fingerprint),
      ],
    );
  }

  if (delta.fixedFingerprints.length) {
    await client.query(
      `UPDATE code_bugbot_findings
          SET resolved_at = now(), resolved_sha = $3
        WHERE org_id = $1::uuid AND scope_key = $2
          AND resolved_at IS NULL
          AND fingerprint = ANY($4::text[])`,
      [input.orgId, input.scopeKey, input.githubSha, delta.fixedFingerprints],
    );
  }

  const fixedSet = new Set(delta.fixedFingerprints);
  return {
    newCount: delta.newFingerprints.length,
    knownCount: delta.knownFingerprints.length,
    fixedCount: delta.fixedFingerprints.length,
    newFingerprints: delta.newFingerprints,
    fixedFingerprints: delta.fixedFingerprints,
    fixed: open.filter((row) => fixedSet.has(row.fingerprint)),
  };
}

/** Tag each finding NEW or KNOWN for the client. */
export function labelBugbotFindings(
  findings: BugbotFinding[],
  newFingerprints: Iterable<string>,
): BugbotFinding[] {
  const fresh = new Set(newFingerprints);
  return findings.map((finding) => ({
    ...finding,
    delta: (finding.fingerprint && fresh.has(finding.fingerprint) ? "new" : "known") as BugbotFindingDelta,
  }));
}

export async function dismissBugbotFinding(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    scopeKey: string;
    fingerprint: string;
    reason: string;
    filePath?: string | null;
    rule?: string | null;
  },
): Promise<void> {
  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 3) throw new Error("A dismissal needs a reason (at least 3 characters).");
  if (!/^[0-9a-f]{4,64}$/i.test(input.fingerprint)) throw new Error("Invalid finding fingerprint");
  await client.query(
    `INSERT INTO code_bugbot_finding_dismissals
       (org_id, scope_key, fingerprint, reason, file_path, rule, dismissed_by)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::uuid)
     ON CONFLICT (org_id, scope_key, fingerprint)
     DO UPDATE SET reason = EXCLUDED.reason, created_at = now()`,
    [
      input.orgId,
      input.scopeKey,
      input.fingerprint.toLowerCase(),
      reason,
      input.filePath?.slice(0, 400) ?? null,
      input.rule?.slice(0, 120) ?? null,
      input.userId,
    ],
  );
}

export async function restoreBugbotFinding(
  client: PoolClient,
  input: { orgId: string; scopeKey: string; fingerprint: string },
): Promise<void> {
  if (!/^[0-9a-f]{4,64}$/i.test(input.fingerprint)) throw new Error("Invalid finding fingerprint");
  await client.query(
    `DELETE FROM code_bugbot_finding_dismissals
      WHERE org_id = $1::uuid AND scope_key = $2 AND fingerprint = $3`,
    [input.orgId, input.scopeKey, input.fingerprint.toLowerCase()],
  );
}
