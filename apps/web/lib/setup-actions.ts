/**
 * One guided list for a setup shell, not two.
 *
 * Almost every feature lib shipped a matched pair: `xSetupSteps(orgId)` and
 * `xNextActions({ shell: "setup" })`. They were written separately and drifted
 * apart in wording, but 26 of them produced *the same ids in the same order* —
 * so a setup screen that rendered both showed a student the identical four-step
 * list twice, once as "Setup steps" and once as "Next actions", with different
 * labels for the same links. Guarding the render hides that; it does not stop the
 * next feature from adding a 27th pair.
 *
 * So the steps are the single source. `setupActionsFrom` is the only way a setup
 * shell's next actions are produced: same ids, same hrefs, same copy, first one
 * primary. Two lists cannot disagree when there is only one list.
 *
 * `setup-actions-contract.test.ts` holds the line — a module whose two helpers
 * return the same ids must return the same content, which is only true if it
 * derives.
 */

export type SetupStepLike = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SetupNextAction = SetupStepLike & { primary?: boolean };

/**
 * Turn a feature's setup steps into the next actions its setup shell offers.
 *
 * The first step is the primary call to action — setup steps are already written
 * in the order a team should work through them.
 */
export function setupActionsFrom<T extends SetupStepLike>(steps: readonly T[]): SetupNextAction[] {
  return steps.map((step, index) => ({
    id: step.id,
    label: step.label,
    detail: step.detail,
    href: step.href,
    ...(index === 0 ? { primary: true } : {}),
  }));
}
