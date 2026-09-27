# Marketing design and claim review

Reviewed 2026-09-27. This pass updates the public product story and shared marketing design; it does not establish completion of the production plan.

## Design

The headline identifies the whole FRC season. A navigable product map introduces Home and the four workspaces. Teal accents, quieter surfaces, readable typography, consistent cards and a compact phone menu replace the oversized sales headline and simulated dashboard. The homepage now moves from workspaces to scouting to connections, with fewer repeated sections. Essential workspace and data-access information remains visible on phones.

Apple's [materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) informs restrained navigation translucency and readable content. Tesla's [touchscreen guide](https://www.tesla.com/ownersmanual/model3/en_ie/GUID-518C51C1-E9AC-4A68-AE12-07F4FF8C881E.html) describes personal shortcuts and an app launcher; the public copy now accurately describes Vantage's existing personal island. Microsoft's [navigation guidance](https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics) supports organizing destinations around related tasks. These are design references, not endorsements or numerical certifications.

## Claims corrected

| Previous claim or presentation | Replacement |
| --- | --- |
| The season stops living in spreadsheets | A connected workspace for the whole FRC team; Google copies disclosed |
| Arbitrary win bars and ranking charts with no data | Labeled product/workflow overviews with no invented probabilities or rankings |
| Every screen works without a signal | Prepare forms online; supported scouting entries save locally; server features require connectivity |
| Four fixed mobile tabs / Logistics as another workspace | Home, Competition, Team, Build and Business; personal island shortcuts; Logistics inside Team |
| Every tool runs without AI | Specific core workflows work independently; assistants require a connection |
| AI only uses a team's key | Personal Codex and personal or team provider keys; external costs remain separate |
| CAD setup is one click and the entire setup | Account or local connector setup, document selection and connection check; external specialist editors retained |
| Automatic build book anyone can follow | Assembly documentation requires review for completeness and engineering correctness |
| Export everything any time; absolute personal privacy | Permission-scoped exports and the policy's operator/provider access explanation |
| Search metadata advertises paid hosted-AI plans | The existing no-subscription Vantage model and separate provider costs |

The FAQ retains its existing question anchors while correcting answers. Social preview, homepage metadata, feature catalog, For teams, workflow and CAD/strategy explanations are aligned. No product service, permission, data migration or signup gate changed.

## Verification

- Focused ESLint and web TypeScript passed; 63 unit tests across 10 files passed.
- Local production build generated all 746 pages.
- 26 focused browser checks passed in their development test environment.
- The same production build passed all 16 default axe scans across eight routes at 390px and 1280px. No rule or region exclusions. Incomplete contrast findings are retained, not counted as conclusive passes.
- The broader built run reported 24 passes and two failures: unavailable email-code provider configuration and use of a documented development-only authentication fixture. Neither is hidden or waived. That run does not prove production email delivery or authenticated theme persistence.
- Actual Chrome confirmed the signed-in marketing link opens the real saved Home board. Phone and desktop visuals were inspected; the 320px automated check verifies workspace links, target sizes, Escape/focus restoration and the offline explanation.

[Machine-readable evidence](evidence/marketing-refresh.json) includes individual results, accessibility findings, build ID and source hashes. The prior full CI results apply to the earlier UI revision, not automatically to this marketing change. All production configuration, recovery, provider, load and full-workflow gates remain open as recorded in STATUS.md. No production deployment or main merge is part of this pass.
