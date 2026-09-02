import { mkdir, writeFile } from "node:fs/promises";
import { isolationFolderNote, orgWorkspacePath, parseOrgIdHeader } from "./org-workspace";

export async function ensureOrgWorkspace(
  orgIdHeader: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ orgId: string; folder: string; note: string } | null> {
  const orgId = parseOrgIdHeader(orgIdHeader);
  if (!orgId) return null;
  const folder = orgWorkspacePath(orgId, env);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(`${folder}/.vantage-org`, `${orgId}\n`, { encoding: "utf8", flag: "w" });
  await writeFile(
    `${folder}/README.md`,
    `# Team workspace\n\nThis folder is only for organization ${orgId}. Sibling org-* folders belong to other teams.\n`,
    { encoding: "utf8", flag: "w" },
  );
  return { orgId, folder, note: isolationFolderNote(orgId, folder) };
}
