import { getAllianceBoardPool } from "@vantage/db/alliance-board";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      return Response.json({ error: "Alliance board token is required" }, { status: 400 });
    }
    const result = await getAllianceBoardPool().query<{ snapshot: unknown }>(
      `SELECT get_alliance_board_snapshot($1) AS snapshot`,
      [token],
    );
    return Response.json(result.rows[0]?.snapshot ?? null);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Alliance board unavailable",
      },
      { status: 400 },
    );
  }
}
