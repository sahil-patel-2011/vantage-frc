# Scouting trends, access and first-run review

The increment adds observed event trends to Competition → Teams, a `manage_scouting` capability, a Scouting lead starter/custom role, account-scoped first-run tracking and shared exit motion. It preserves the existing saved Home and scouting/queue APIs.

| Workflow | Intended result | Verification |
| --- | --- | --- |
| Event trends | Real schema answers; no-climb outcomes, confidence/missing samples, deduplicated robot-match evidence and earlier/later qualifiers | Five aggregation unit cases; phone/dark and desktop/light client cases |
| Form and data management | Owner/admin or delegated lead manages scouting, ordinary scouts collect/view | Capability/repository/API unit tests; isolated PostgreSQL grant/apply/revoke/foreign-team tests |
| Custom roles | Editing keeps tab restrictions; applying is explicit; lead always reaches Competition | Mobile edit/create/apply client case; PostgreSQL role application check |
| Member access | Preset choices populate the editable draft; revocation precedes hub restrictions; saves report failures | Source review and domain grant/revoke coverage; remote multi-user acceptance pending |
| First run | Server claims before display; existing accounts never replay; lost browser marker cannot replay | Concurrent API claim unit case, first-visit/reload browser case and isolated account RLS check |
| Cookie choice | No automatic signed-in popup; explicit Privacy remains usable without granting analytics | Client navigation/privacy case |
| Closing dialogs | Short inert exit, focus restoration and reduced motion | Two browser cancel/Escape/reopen cases; Home and confirm wrappers retain exiting content |
| App-wide recovery UI | Real unavailable/setup states and canonical workspace navigation | Eight responsive censuses at 320/390/768/1440, light/dark; database-free controlled APIs |

Custom access roles and season responsibilities have different purposes: the former grant authority and the latter record who owns work. Event observation trends and official EPA alerts also have separate sources and purposes. No new parallel dashboard or duplicate route was added.

The first new tour run failed because the common sign-in fixture deliberately marked every tour already taken. It now has an explicit first-run mode; the first-visit assertion remains. The trends selector was made explicit and duplicate/missing-answer assertions were retained. Initial stale unit fakes for the previous owner/admin role query were updated to the capability contract, including delegated/denied cases. Initial lint/type errors were repaired before acceptance.

No laptop database was started and no production schema or settings were changed. Remote GitHub Actions scratch databases were explicitly authorized by the user. Remote results are recorded separately; database-free API fixtures do not prove persistence or production readiness. Existing signup/media gates remain. Missing production credentials and live-provider/recovery/capacity gates remain in UI-READINESS-2026-10-06.md.

Database-free checks pass 1,534 unit files / 11,416 tests (18 files / 47 tests skipped), lint, all workspace types and the optimized build (754 pages generated). The combined client replay passes 31 cases, including eight responsive censuses / 248 presentation states with zero findings. The final seven focused trend/role/first-run/motion cases pass after the last editor refinements. [Machine-readable evidence](evidence/2026-10-06-scouting-trends-access.json) records boundaries and initial failures. [Phone trends](evidence/2026-10-06-trends-390-dark.png) and [desktop trends](evidence/2026-10-06-trends-1440-light.png) show the actual controlled test data.

The expanded recovery census passes 243 registered destinations on phone/light and desktop/dark (486 states). Exact-head remote run 37537400923 passes quality, PostgreSQL migrations/RLS (including lead and tour cases), and database-free UI. All eight browser shards fail; their initial failing cases are preserved in `evidence/2026-10-06-browser-initial-failures.json`. Acceptance remains open. Repairs use real persistent Home fixtures, canonical controls and server-returned role keys, respect auth retry windows, settle theme motion before contrast scans, and remove Next development indicators only in isolated test runs. The private-message picker now portals above event chrome; obsolete Hide when empty controls are removed because Home keeps saved cards. These changes require a fresh browser replay before merge.
