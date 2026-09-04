import type { PoolClient } from "@neondatabase/serverless";
import { isDefaultIslandSelection, isValidIslandSelection } from "../nav/island-preferences";
import { personalizeWithFreebuff } from "./personalize-ai";
import { personalizeFromRoles, type PersonalizeInput, type RolePersonalization } from "./personalize";

export async function applyRolePersonalization(
  client: PoolClient,
  input: PersonalizeInput & {
    userId: string;
    orgId: string | null;
    /** When true, overwrite a stock Home/Compete/Team/Business island. */
    replaceDefaultIsland?: boolean;
  },
): Promise<RolePersonalization> {
  const personalized = input.orgId
    ? await personalizeWithFreebuff(client, input)
    : personalizeFromRoles(input);

  const existing = await client.query<{ tabs: unknown }>(
    `SELECT island_tabs AS tabs FROM profiles WHERE user_id = $1`,
    [input.userId],
  );
  const current = existing.rows[0]?.tabs;
  const shouldWrite =
    !isValidIslandSelection(current) ||
    (Boolean(input.replaceDefaultIsland) && isDefaultIslandSelection(current));

  if (shouldWrite) {
    await client.query(
      `INSERT INTO profiles(user_id, island_tabs)
       VALUES($1, $2::jsonb)
       ON CONFLICT(user_id) DO UPDATE SET island_tabs = excluded.island_tabs`,
      [input.userId, JSON.stringify(personalized.islandHrefs)],
    );
  }

  return personalized;
}
