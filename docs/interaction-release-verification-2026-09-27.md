# Interaction release verification

## Defects corrected

- Switching teams could update the drawer and permissions while leaving the mounted scouting form attached to the previous team. Real browser/database tests reproduced a report saved to the wrong team at both 390 and 1440 pixels. Team switches now reload the document; same-team navigation retains context through Home, account, settings and supporting tools. Shared session reads follow the selected team and never silently substitute another membership for an unauthorized team ID.
- The notification bell counted other teams' alerts while the inbox showed only the selected team. Counts now use the same scope and live-record filter. Opening the inbox acknowledges displayed notifications, and read/unread actions update the bell immediately. Batch updates reject another person's or another team's IDs without partial changes.
- Failed sign-out requests previously navigated away as though successful. Failure now stays on the page and permits retry. Successful sign-out revokes the session, clears the remembered-team cookie and downloaded feature snapshots, and preserves unsent scouting reports and drafts.
- Protected API requests redirected to HTML sign-in/onboarding pages, which fetch followed to misleading 200 responses. They now return JSON 401/403 errors; page navigation still redirects normally.

## Acceptance evidence

| Journey | Evidence |
| --- | --- |
| Team A owner → Team B scout → save → Home → settings → switch back → refresh/back | Real sessions, real restricted PostgreSQL roles, desktop and phone; saved report's organization checked directly in PostgreSQL |
| Notification badge → inbox → mark unread → mark all read → refresh | UI and persisted read state; deleted-source, other-team and other-person notifications exercised |
| Unauthorized notification batch | Rejected; neither the authorized nor unauthorized row changed |
| Failed sign-out → retry → success | Browser requests; old session cookie explicitly replayed and rejected; selected-team cookie removed |
| Downloaded views and unsent work at sign-out | Feature snapshots cleared; pending scouting record retained in its separate device store |
| Landing → sign-in → authenticated Home | Real Better Auth session, plus destination-preserving signed-out redirects and unknown-page 404 |
| Existing event-free scouting | Phone/desktop draft recovery, offline save, reconnect, idempotent upload, identity isolation and raw observations |
| Shared controls | Existing navigation, account, offline inbox and mobile checks retained; full PR CI is required before merge |

All destructive fixtures use isolated local/CI PostgreSQL. Test organizations and reports use unique IDs and are removed by their owning tests. No production customer records are modified by these browser fixtures.

Local validation: 11,062 unit tests passed, 29 existing conditional skips; lint, workspace types and production build passed. Browser regression evidence and full CI status are recorded on the release PR. No schema migration is required.

## Release limits

This verifies the interaction fixes and regression coverage; it is not a claim that every possible button/state is defect-free. Automated accessibility checks are sampled, not an Apple/Google/Microsoft certification or a user-study score.

The broader completion plan still requires separate evidence for live self-service provisioning, recovery journals/retention and load targets, personal Codex/device execution, enabled external connectors and full production onboarding journeys. Those requirements cannot be counted as complete from local fixture tests. Public onboarding is not opened by this release. The existing unfinished production-completion branch is not part of this merge.

Deploy through the existing main-branch Vercel integration after required checks pass; do not trigger a duplicate CLI deployment. Verify the production alias, deployed Git revision, public navigation/authentication boundary and runtime errors after promotion. An application rollback can use the previous Vercel deployment; this release adds no database migration.
