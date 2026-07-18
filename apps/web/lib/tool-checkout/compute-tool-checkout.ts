import type { PoolClient } from "@neondatabase/serverless";
import { statusFor, summarizeToolCheckout, TOOL_CATEGORIES } from ".";
import type { ToolCategory, ToolCheckoutLoan, ToolCheckoutSummary, ToolCheckoutTool } from "./types";

export { TOOL_CATEGORIES };

export type ToolCheckoutSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ToolCheckoutView =
  | {
      status: "setup_required";
      message: string;
      steps: ToolCheckoutSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      tools: ToolCheckoutTool[];
      summary: ToolCheckoutSummary;
      computedAt: string;
    };

type ToolRow = {
  id: string;
  name: string;
  category: ToolCategory;
  assetTag: string | null;
  location: string | null;
  notes: string | null;
  active: boolean;
};

type LoanRow = {
  id: string;
  toolId: string;
  borrowerName: string;
  checkedOutAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  notes: string | null;
};

function mapLoan(row: LoanRow): ToolCheckoutLoan {
  return {
    id: row.id,
    borrowerName: row.borrowerName,
    checkedOutAt: row.checkedOutAt,
    dueAt: row.dueAt,
    returnedAt: row.returnedAt,
    notes: row.notes,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeToolCheckoutView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ToolCheckoutView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to track tool checkout.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [toolResult, loanResult] = await Promise.all([
    client.query<ToolRow>(
      `SELECT id, name, category, asset_tag AS "assetTag", location, notes, active
       FROM tool_checkout_tools
       WHERE org_id = $1 AND active = true
       ORDER BY name`,
      [org.orgId],
    ),
    client.query<LoanRow>(
      `SELECT id, tool_id AS "toolId", borrower_name AS "borrowerName",
              checked_out_at::text AS "checkedOutAt", due_at::text AS "dueAt",
              returned_at::text AS "returnedAt", notes
       FROM tool_checkout_loans
       WHERE org_id = $1
       ORDER BY checked_out_at DESC`,
      [org.orgId],
    ),
  ]);

  const loansByTool = new Map<string, LoanRow[]>();
  for (const row of loanResult.rows) {
    const list = loansByTool.get(row.toolId) ?? [];
    list.push(row);
    loansByTool.set(row.toolId, list);
  }

  const now = new Date();
  const tools: ToolCheckoutTool[] = toolResult.rows.map((row) => {
    const loans = loansByTool.get(row.id) ?? [];
    const openLoan = loans.find((loan) => !loan.returnedAt) ?? null;
    const currentLoan = openLoan ? mapLoan(openLoan) : null;
    const loanHistory = loans.filter((loan) => loan.returnedAt).map(mapLoan);
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      assetTag: row.assetTag,
      location: row.location,
      notes: row.notes,
      active: row.active,
      status: statusFor(currentLoan, now),
      currentLoan,
      loanHistory,
    };
  });

  const summary = summarizeToolCheckout(tools);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    tools,
    summary,
    computedAt: now.toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addTool(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    category: ToolCategory;
    assetTag: string | null;
    location: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO tool_checkout_tools (org_id, name, category, asset_tag, location, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.orgId, input.name, input.category, input.assetTag, input.location, input.notes, input.userId],
  );
}

export async function retireTool(client: PoolClient, input: { orgId: string; toolId: string }): Promise<void> {
  await client.query(`UPDATE tool_checkout_tools SET active = false WHERE id = $1 AND org_id = $2`, [
    input.toolId,
    input.orgId,
  ]);
}

export async function checkoutTool(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    toolId: string;
    borrowerName: string;
    dueAt: string | null;
    notes: string | null;
  },
): Promise<void> {
  const existing = await client.query(
    `SELECT 1 FROM tool_checkout_loans WHERE org_id = $1 AND tool_id = $2 AND returned_at IS NULL`,
    [input.orgId, input.toolId],
  );
  if (existing.rowCount) throw new Error("Tool is already checked out");

  await client.query(
    `INSERT INTO tool_checkout_loans (org_id, tool_id, borrower_name, due_at, notes, checked_out_by)
     VALUES ($1,$2,$3,$4::timestamptz,$5,$6)`,
    [input.orgId, input.toolId, input.borrowerName, input.dueAt, input.notes, input.userId],
  );
}

export async function returnTool(
  client: PoolClient,
  input: { orgId: string; loanId: string },
): Promise<void> {
  await client.query(
    `UPDATE tool_checkout_loans SET returned_at = now()
     WHERE id = $1 AND org_id = $2 AND returned_at IS NULL`,
    [input.loanId, input.orgId],
  );
}
