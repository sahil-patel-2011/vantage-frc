# UI reliability and production readiness — October 6, 2026

The release remains unverified. This increment repairs presentation and client reliability across the existing application. No local database was started, no production database connection was opened, and no production secret was changed.

## Behavior repaired

- Form responses distinguish observed zero from missing answers, filter actual rows, and count reporting scouts within the visible results. Switching to the scout breakdown clears the effect of its hidden individual filter. Failed refreshes preserve the last successfully loaded responses with an explicit stale label; expired sessions and revoked access remove them. Team/form changes cannot display the previous scope's response snapshot.
- Scouting waits for the first server refresh before restoring a cached saved report, so newer corrections replace old cached answers. Phone and desktop tests exercise the normal browser cache across navigation.
- Failed shortcut and code-preference loads disable writes and offer independent retries, preventing defaults from overwriting saved choices. Loads and saves have bounded timeouts.
- Home coverage shows loading and unavailable states, offers refresh, and uses actual schedule denominators. Unknown budget values do not become $0. Temporary service failures offer retry instead of claiming the team needs setup.
- Inbox tools sit below its page title. The default blue accent and AI settings labels meet the checked contrast requirements. Parent and reimbursement pages receive the shared page container. The Team 6925 command can be focused and scrolled with a keyboard. Search opens the dedicated AI connection page and retains the selected team.

## Dependency repairs

The registry audit initially reported one critical, 24 high and 13 moderate package findings across all workspaces. Both Next applications now pin 16.3.6, the patched version for the [ImageResponse advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j). Sharp is upgraded to 0.35.5, Electron to 43.7.8, and Workflow to 4.8.12. Its pinned devalue 5.9.2 is overridden with compatible 5.9.4; Workflow's updated serialization package supplies Undici 7.30.0. Compatible brace-expansion, source-map-js and HTTP cache dependencies are refreshed in the lockfile.

The resulting production-only web/marketing dependency audit reports **zero vulnerabilities**. CI now rejects high/critical production dependency findings. The complete workspace audit retains five high and 11 moderate findings in development/desktop packaging tools. The five high entries trace to [braces, which has no upstream patched release](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); this remaining tool-chain risk is explicitly recorded. Package findings include transitive parents, rather than 16 independent flaws. No forced dependency downgrades or major-version upgrades were applied.

## Verification boundaries

`npm run test:ui` starts an isolated Next application with database connections and provider credentials disabled. Every browser API request is intercepted. Known contracts supply controlled responses; unknown services deliberately fail with 503 to exercise recovery screens. These tests establish client behavior, accessibility and responsive presentation, **not persisted workflows or working external integrations**.

The initial complete desktop scan visited 238 registered destinations and found four issues: missing containers on Parents/Reimbursements, low-contrast AI settings labels, and Gearbox exceeding the previous five-second readiness deadline during a cold redirect. The phone scan visited 242 destinations and found one keyboard-focus issue on the Team 6925 command. Both scans recorded no page JavaScript errors. Original findings are retained in the evidence file; repaired destinations are included in the final responsive replay.

The first repaired replay passes 18 tests: ten client-interaction cases and eight presentation censuses, covering 31 destinations at 320, 390, 768 and 1440px in light/dark appearances (248 presentation states). All censuses record zero WCAG violations, horizontal overflow or page JavaScript errors. [Original findings](evidence/2026-10-06-ui-census-original.json) and [pre-patch replay](evidence/2026-10-06-ui-responsive-prepatch.json) are preserved. The [final dependency-patched replay](evidence/2026-10-06-ui-responsive-final.json) also passes all 18 tests and 248 states on Next.js 16.3.6, with no retries or findings.

Final dependency-patched unit checks pass 1,528 files / 11,370 tests with 18 files / 45 tests explicitly skipped. Repository lint, all workspace types, a consistent installed dependency tree, and the optimized web build pass without a database. The skipped tests and controlled API fixtures do not close the persisted-workflow gates.

Representative controlled-response screenshots: [desktop light](evidence/2026-10-06-responses-1440-light.png) and [phone dark](evidence/2026-10-06-responses-390-dark.png).

The remote PostgreSQL/RLS and complete browser jobs remain required for ready PRs and main. Draft PRs run quality and database-free UI checks; marking a PR ready triggers the remaining gates. On October 6 the user explicitly authorized isolated GitHub Actions test databases. Laptop databases remain prohibited.

## Scouting collection and analysis increment

Match scouting now records shooting, feeding, defense and disabled intervals against the persisted match clock. Unfinished activities survive reload and must be stopped before saving. Removed activities retain their original interval and can be restored. Released-fuel throughput uses only counted intervals; unknown answers remain blank and observed zero remains zero. FMS hub ordering stays unconfirmed until entered, and autonomous/endgame climbs are separate questions.

New 2026 forms use the season starter rather than generic scoring questions. The builder preserves phase and explicit-observation settings through editing, preview and publication. Practice reports preserve activity metadata through save/synchronization, and actual-report comparisons show numeric, yes/no and categorical capability evidence without requiring a scoring formula. Private CSV exports include the activity data. Existing published schemas are not rewritten.

The final six-case scouting browser replay passes at 390/1440px in light/dark appearances. It exercises collection, draft/clock recovery, offline queueing, API acknowledgment, report review, unknown/zero distinctions, categorical comparisons, practice saves and season-form publish payloads. The broader replay also passes all ten existing client cases and all eight responsive censuses (248 states, no accessibility, overflow or page-error findings). Its initial new-form test failure was an incorrect test selector for the native form-type control; the corrected six-case replay passes without retries. [Detailed evidence and verification boundaries](evidence/2026-10-06-scouting-activity-client.json) retain that failure and replay outcome.

Database-free checks pass 1,531 unit files / 11,405 tests, with 18 files / 45 tests skipped, plus repository lint, all workspace types and the optimized web build. Browser APIs are controlled responses: this does not establish fresh-user sign-in, team setup, invitations, remote schema publication, PostgreSQL persistence, RLS or live provider behavior. No local database was started. Full production acceptance and Lovat feature parity remain unverified.

Representative screenshots: [phone recorder](evidence/2026-10-06-scouting-activity-390-light.png), [phone comparison](evidence/2026-10-06-scouting-comparison-390-light.png), [desktop recorder](evidence/2026-10-06-scouting-activity-1440-dark.png), and [desktop comparison](evidence/2026-10-06-scouting-comparison-1440-dark.png).

## Production gates still open

Read-only [Vercel metadata](evidence/2026-10-06-production-metadata.json) reports a READY production deployment but six missing required settings: `RECOVERY_ENCRYPTION_KEY`, `EXPORT_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`, `MFA_RECOVERY_PEPPER`, `RATE_LIMIT_REDIS_URL`, and `RATE_LIMIT_REDIS_TOKEN`. Existing protected credentials are present but their behavior is unverified. Database role privileges and live email delivery have not been rechecked.

Main's previous [CI run](https://github.com/sahil-patel-2011/vantage-frc/actions/runs/37517048774) passed quality and PostgreSQL checks but failed all eight browser shards. The failures include outdated UI expectations and incomplete functional evidence; this increment does not claim those gates have passed.

Fresh users/teams, invitations, custom form publication, persisted scouting/analysis, provider operations, recovery restore and capacity/cost proof still require the authorized remote environment and production verification. Public signup and media upload switches remain unchanged.

The trends, scouting lead, role-editor and first-run follow-up is recorded in [trends/access review](SCOUTING-TRENDS-ACCESS-2026-10-06.md).
