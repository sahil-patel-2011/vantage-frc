# Workspace UI review — September 30, 2026

This release builds on the current UI in main (6340a1acb). It retains the desktop rail, phone bottom bar, draggable pick lists, form builder, saved Home boards, and all existing feature routes.

## Changes

- Home: board selection and Edit share one aligned control group. Live card headings open their destination, replacing the repeated footer link; empty cards retain their relevant setup action.
- Secondary tools: one searchable selector, a single current-tool label, readable stacked descriptions, and more vertical room. Keyboard opening, arrow navigation, Escape, and focus restoration remain supported. The picker measures available space above the phone bar and listens for viewport/keyboard resizing; narrow, landscape, and tablet checks verify that its last tool can receive a pointer hit.
- Finance: keep Open Money visible; put Season budget and Purchase orders under Budget and orders. All three actions remain available.
- Shared buttons: lighter contact shadows and stationary pointer targets on press. Semantic status colours, light/dark tokens, reduced motion, and touch targets remain in place.
- Loading: remove the hub's content-observer gate. It withheld the very components needed to produce content until an eight-second fallback fired. Render the view immediately with a Suspense fallback.

## Validation

115 focused unit tests passed, along with web typechecking and lint of changed files. Seventeen signed-in desktop/phone browser journeys passed for Home editing, navigation, account menus, shared workspace accessibility, actual card destinations, and prompt workspace requests. The final focused suite also checks current-tool naming, search focus, and preserved card heading names.

The request-timing regression warms the module, switches Calendar to Work through its tab, and requires the actual /api/todos request within five seconds. This fails against the previous eight-second gate. No fake delay or mocked successful mutation establishes the result.

Accessibility checks preserve automated violations and incomplete/manual checks in Playwright attachments. Screenshots are captured at 390 and 1440 pixels; broader existing accessibility journeys also cover 1280 pixels. Automated accessibility checks are not a usability certification or an Apple/Google/Microsoft score.

Full repository lint, workspace typechecks, unit tests, build, PostgreSQL/RLS checks, and all browser shards are release gates on PR #2337. Production verification follows merge and a single Vercel deployment.

## Design references

- [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials): keep translucent navigation distinct from readable content surfaces.
- [Google Material foundations](https://m3.material.io/foundations/): consistent tokens, hierarchy, and interaction.
- [Microsoft Fluent buttons](https://fluent2.microsoft.design/components/web/react/core/button/usage): action hierarchy and legible interactive states.
