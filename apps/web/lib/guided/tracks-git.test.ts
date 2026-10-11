import { describe, expect, it } from "vitest";
import { runPasteVerifier } from "./checks-6925";
import { GIT_TRACKS } from "./tracks-git";
import type { GuidedStep } from "./types";

const track = GIT_TRACKS[0]!;
const step = (id: string): GuidedStep => track.steps.find((s) => s.id === id)!;
async function paste(id: string, text: string) {
  const check = step(id).check;
  if (check.kind !== "paste") throw new Error(`${id} is not a paste check`);
  return runPasteVerifier(check, text);
}

describe("Git and GitHub: your first pull request", () => {
  it("teaches when to use each step with an example and ends with a reviewed practice pull request", () => {
    for (const s of track.steps.slice(0, -1)) {
      expect(s.whenToUse?.length ?? 0, `${s.id} says when`).toBeGreaterThan(30);
      expect(s.example?.length ?? 0, `${s.id} has an example`).toBeGreaterThan(20);
    }
    const practice = track.steps.at(-1)!;
    expect(practice.practice).toBe(true);
    expect(practice.check).toMatchObject({ kind: "github-pr", minComments: 1 });
  });

  it("reads the install output from Windows and macOS", async () => {
    const ok = await paste(
      "install",
      "git version 2.47.1.windows.1\ngh version 2.63.2 (2024-12-05)\ngithub.com\n  ✓ Logged in to github.com account student (keyring)",
    );
    expect(ok.passed).toBe(true);
    const missing = await paste("install", "git version 2.39.5 (Apple Git-154)\ngh : The term 'gh' is not recognized as the name of a cmdlet");
    expect(missing.passed).toBe(false);
  });

  it("wants a clone from GitHub", async () => {
    const ok = await paste(
      "clone",
      "Cloning into 'robot-2026'...\nremote: Enumerating objects: 812, done.\norigin\thttps://github.com/team/robot-2026.git (fetch)\norigin\thttps://github.com/team/robot-2026.git (push)",
    );
    expect(ok.passed).toBe(true);
    const ssh = await paste("clone", "Cloning into 'robot'...\norigin  git@github.com:team/robot.git (fetch)");
    expect(ssh.passed).toBe(true);
  });

  it("refuses main as the working branch", async () => {
    expect((await paste("branch", "Switched to a new branch 'fix-intake-speed'\nfix-intake-speed")).passed).toBe(true);
    const onMain = await paste("branch", "Switched to a new branch 'x'\nmain");
    expect(onMain.passed).toBe(false);
    expect(onMain.message).toMatch(/still on main/);
  });

  it("wants a real commit, not nothing to commit", async () => {
    expect((await paste("commit", "[fix-intake-speed 3f2a9c1] Lower intake speed\n 1 file changed, 1 insertion(+), 1 deletion(-)\n3f2a9c1 Lower intake speed")).passed).toBe(true);
    const nothing = await paste("commit", "On branch fix\nnothing to commit, working tree clean\n3f2a9c1 Old commit");
    expect(nothing.passed).toBe(false);
  });

  it("passes a clean merge and names a conflict", async () => {
    expect((await paste("update", "Already up to date.")).passed).toBe(true);
    expect((await paste("update", "Updating 1a2b3c4..5d6e7f8\nFast-forward\n src/main/java/frc/robot/Robot.java | 2 +-")).passed).toBe(true);
    const conflict = await paste("update", "Auto-merging Robot.java\nCONFLICT (content): Merge conflict in Robot.java\nAutomatic merge failed; fix conflicts and then commit the result.");
    expect(conflict.passed).toBe(false);
    expect(conflict.message).toMatch(/conflict/);
  });
});
