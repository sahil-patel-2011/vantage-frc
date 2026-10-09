# Scouting and Home journey changes — October 9, 2026

This is a source review record for the main-based scouting-journey-polish candidate, not production acceptance. No local test, build, server, database, browser runner, installation, GitHub Actions run, or deployment was performed for this candidate.

## Candidate behavior

| Task | Canonical controls and result |
| --- | --- |
| Home | New personal boards contain tasks, calendar and scouting coverage. Saved boards retain their layout. The board menu reveals quiet widgets; Customize keeps them editable. Failed widgets remain visible. |
| Home actions | A visible task card owns task creation; its duplicate header shortcut is hidden. Customized boards without that card keep the shortcut. Task saves have a synchronous submit guard and timeout, with uncertain saves directing the member to check All tasks before retrying. Changing teams remounts the task editor. |
| Home loading | Device cache loads alongside the live request. Account/team/board request generations prevent older responses from repainting a new scope. Access denial removes downloaded views and offers sign-in or access reload. |
| Build a form | One question document with Questions, Preview and Responses. One publication area; question jumping, insert-after-selection, duplication and accessible reordering. Advanced answer conditions remain within the question. |
| Recover a form | Private drafts retain account, team, year, form type and editor identity. Competing editors use separate storage keys. Cleanup removes only the exact recovered revision. |
| Publish a form | Lead authorization precedes persistence. A transaction lock and baseline ID detect competing publication. Successful acknowledgement becomes the local baseline without another POST. A stale editor receives 409 and keeps its draft. |
| Collect a report | Before → Auto → Teleop → Endgame → Review, with manual phase access. Event, practice and preview use the same answer controls and conditional rules. One review/save action; the timer has no second save button. |
| Required answers | Missing counts remain missing. Zero and false are explicit observations. Untouched subcounts are not manufactured by tapping another counter. Review identifies missing answers and focuses an enabled control. |
| Correct an event report | Original schema ID is included in report listings. New drafts retain schema, source and client ID. Corrections resolve the original form under team authorization; missing original forms block collection rather than falling back to new questions. Older legacy drafts without schema metadata remain readable. |
| Practice recovery | Drafts retain the selected form and submission identity. Local queuing precedes draft clearing. Save/reconnect/manual retry uploads; a save during an active upload requests a follow-up pass. Rejected reports can reopen after the recovered draft is durable. |
| Practice upload | Only a matching server acknowledgement removes the exact uploaded revision. Transient failures remain queued; rejected answers need attention. Local save and confirmed upload have different labels. No recurring upload timer. |
| Event upload and edits | A bounded drain rechecks for a newly queued robot after upload progress. Requests time out with unsent answers retained. Clearing the final answer also replaces the device draft rather than retaining an older observation. |
| Responses | Refresh on request or page return. Summaries expose answered/missing counts beside the current filters. Blank selections and untouched count groups do not inflate samples. |
| Event trends | Available with or without scoring formulas; the scored view uses the full event, not only robots without totals. Outcomes separate observed success, explicit failure, explicit no attempt, unspecified non-success and unseen/unresolved. “None” never implies no attempt. Declared yes/no choices remain valid through report voting. |
| Trend evidence | Per-robot outcome counts and contributing robot-match answers link to the existing robot detail. Evidence tables render on expansion, with answers revealed in batches of 100. Event/confidence scope, sample gaps and questions absent from older forms remain visible. No additional network polling. |
| Climb ranking | Unseen/unrecognized values no longer become success. Known outcomes use majority voting and success ties stay unknown; a height disagreement can still establish a success. Team detail/comparison label the observed denominator and expose missing outcomes within scored matches. |
| Invitations | New, reissued and provisioned-owner invitations expire within 24 hours. Recipients see the expiry time and time zone. Acceptance has a double-submit guard, request timeout, failure feedback and a confirmed team result before redirecting. Delegated membership managers cannot reissue elevated-role invitations. |
| Scoring | Forms owns one scoring editor. Numeric weights, explicit points per choice/boolean, arithmetic and sample previews use the observed-answer evaluator. Unknown/unseen answers cannot become points; zero and false remain observations. Active role aliases match team analysis; older inactive names remain inspectable. No invented default weights. |
| Scoring recovery | Account/team/formula/editor-scoped drafts recover incomplete numeric inputs. Save checks published question keys/types, lead permission, an exact timestamp revision and a transaction lock. A competing save retains the draft. Discard requires confirmation; cleanup compares the exact stored revision. |
| Account entry | Profile loads and saves have timeouts and mutation guards. Completion requires confirmed state before deleting a local draft. Local answers are account/team-scoped; legacy team-only answers are not read. Already-complete members bypass setup, and completion destinations reject entry-screen loops. |
| Temporary account failure | A failed session or onboarding gate returns 503 to API callers and a quiet retry screen to page navigation. It does not become evidence of sign-out or an incomplete profile. The original destination and filters remain in the retry link; the recovery page is available on both product hosts. |
| Team-code handoff | Signed-in recipients see the verified session email with an explicit account switch. Requests have a timeout and submit guard; only a valid same-site invitation destination is opened. Error feedback receives focus. This does not claim membership before acceptance. |
| Navigation | Competition lists Scout, Forms, Assignments, Teams, Match plan, Pick list, Event day and Our robot. Collection-only members keep a Scout sidebar destination. Desktop navigation has labelled 24px icons and 48px controls with wrapping, focus and reduced-motion treatment. The hamburger avoids repeating its Scout launcher. |
| Modal access | Keyboard navigation includes visible disclosures and excludes hidden, inert and disabled fieldset controls. Closing restores focus through the existing shared modal. Hosted keyboard and visual acceptance remain required. |
| Discard | Named confirmation dialogs describe which draft is removed. Failed draft cleanup leaves the open answers available. Unmounting or replacing a dialog resolves its waiting caller. |

## Compatibility and review

No migration, storage ownership, deployment configuration or workflow configuration changes are included. Published question keys and JSON report identities remain stable. The shared visibility package is exported through its package manifest. Schema reads accept a tenant-checked original schema ID. Publication from an older client without a baseline receives a refresh-required 409; silent overwrites are intentionally refused. Scoring adds a lookup expression kind; the old numeric evaluator remains exported, while team analysis uses nullable observed results. Formula writes now require the published schema ID and current revision (explicit null for first save); old write clients must refresh. Onboarding responses add the signed-in user ID for private draft ownership. Legacy account-ambiguous local answers are retained on disk but never restored to another member.

Reviewed component call sites, package exports, schema/report serialization, role checks, original-form lookup, device queue acknowledgement, stale request guards and reduced-motion behavior. `git diff --check` is the only executed source check. Regression test sources additionally cover mapped scoring, missing/unseen inputs, arithmetic failures, expression bounds, private formula recovery, exact save baselines, role authorization, account outage handling, completion loops, private onboarding keys, validated team handoffs and permission-filtered navigation. They have not been executed for this candidate.

## Still required before production acceptance

- Approved hosted verification of normal, failure and final regression journeys, including two isolated teams, invitation delivery and recipient password setup.
- Phone/tablet/desktop visual and keyboard review, 200% text sizing, light/dark, reduced transparency and motion, focus restoration and visible button results against this exact candidate.
- Hosted measurement using a 40-question form and 1,000-report event; no responsiveness or parity claim is established by source review.
- Required production schema gates and the requested Sheets-primary identity/tenant/storage replacement, without accessing Neon or deleting existing data.
- Desktop CAD acceptance remains deferred; this candidate makes no packaged-app claim.
- Verified actual deployment allowance before one intentional deployment and hosted smoke check. Actions remain disabled.

Production data access, email delivery and the full app journey have not been proven. Keep this candidate in draft until the acceptance gates can be completed within AGENTS.md and the user's storage/compute rules.
