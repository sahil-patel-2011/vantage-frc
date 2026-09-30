# AI workspace consolidation — September 30, 2026

## Behavior

The AI page previously offered Chat, Writer, Agent, Controls and Notes as five large tabs, with more navigation inside the tools. It now uses one compact workspace selector for Chat, Write and Run a task. Notes, limits, memory and other tools open contextually; existing feature URLs and permissions remain supported.

Editors load on first use and stay mounted while switching modes or closing a tool panel. Unsent input, draft questions, preview-only profile edits and task goals survive these changes. Changing organizations creates a fresh workspace so another team's editor state cannot carry across.

The writer exposes all six draft types through one labeled selector. Its team profile is expandable inside the workspace, leaving the composer visible first. Agent history refresh sits beside history rather than beside the task's primary action. Nested history shadows are removed, and the Tools label remains visible on narrow phones.

The shared hub can defer navigation to an integrated workspace without bypassing its access gates. The action menu gains an opt-in menu-only layout. The modal gains opt-in editor retention and initializes its focus trap after its portal mounts, including directly opened Notes URLs. Other consumers keep their existing defaults.

## Verification and scope

- Base: main `f35cbf6c9860fc358b1403fafe8e07ec528f5b2d`, following merged PRs #2338 and #2339. The primary checkout's two local `.claude` files were preserved.
- Repository lint and workspace typechecks passed. Changed source is linted again and the final web types checked before release.
- Relevant unit checks: 210 passed across 26 files, with six existing conditional skips in one file. No skips were added.
- Nine distinct browser journeys passed against real local PostgreSQL and Better Auth accounts, covering the four new workspace regressions, hub navigation, Notes, Chat chrome and the shared mouse menu.
- New workspace checks cover 320, 768 and 1440 pixel layouts, all draft types, unsaved task/draft retention, settings panel close/focus return, Notes deep links, one visible page heading and no horizontal document overflow. Keyboard profile disclosure and preview retention were added and verified separately.
- WCAG A/AA checks found no violations in the tested writer, agent and Notes states. Screenshots of Chat, Write and Run a task were inspected; this is evidence for these states, not a universal usability score.
- The first browser attempt selected a grant field while the writer correctly defaulted to sponsorship. The test now selects Grant first. The existing Notes shell test needed a real authenticated team to exercise the contextual editor; it now uses its seeded owner. Assertions still require the intended feature to open, and neither failure was skipped.

Full GitHub quality, migration/RLS, production build and eight browser shards remain merge gates. The compiled local repetition and final CI/deployment evidence are recorded in the PR and handoff.

No schema, production records, media controls, signup eligibility or external credentials change in this release. UI verification does not demonstrate provider execution: live AI requests still require the appropriate personal connection or configured provider. The broader Google recovery/load, SMTP and other production acceptance work described in the existing release status remains unverified where evidence is missing.
