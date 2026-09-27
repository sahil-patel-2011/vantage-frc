# Scouting evidence and sharing review — September 27, 2026

## Decision update

The user's September 27 instructions supersede the original plan's opt-in sharing default. The user explicitly answered **“Include past reports too.”** Migration 0706 enables the scouting network for existing teams and defaults new teams to enabled. Owners and admins can opt out. The immutable PLAN.md remains unchanged.

This is an implementation and local verification record, not production acceptance. Main, production schema, production signup and Vercel are unchanged.

## Reference behavior

- [Lovat](https://lovat.app/): contextual collection, offline transfers, and team lookup with metric detail.
- [Public collection repository](https://github.com/HighlanderRobotics/lovat-collection): persisted reports, match phases, contextual actions and review.
- [Public dashboard repository](https://github.com/HighlanderRobotics/scouting_dashboard_app): metric categories, contributing-match drill-down, source descriptions and pick-list controls.
- [FIRST 2026 manual](https://firstfrc.blob.core.windows.net/frc2026/Manual/HTML/2026GameManual.htm): 20-second autonomous, 3-second scoring pause, 140-second teleop, last 30 seconds endgame.

The implementations are independent. No third-party source was copied. This review does not establish speed parity or universal superiority over Lovat.

## Delivered behavior

- Primary Teams lookup starts with capabilities, match reports and private notes. Event, match and confidence filters select actual reports; the active event is the initial scope.
- Metrics expose their definition, units when supplied by the form, sample count, missing answers, observed range, original answers and disagreements. Missing answers are not zero. Duplicate robot-match reports combine before averages. Categorical ties remain unanswered.
- Low-confidence reports are visible on request rather than silently discarded. Original match reports remain inspectable; position/path graphics use the form's grid.
- The embedded Robots view retains its scoring/ranking workflows and adds raw capabilities even without a scoring formula. “Average” sorts the displayed average. Advanced weights are collapsed but remain editable and persistent.
- Official ratings and public research are grouped separately. The old “Our scouting” rating filter is correctly labeled “Our robot”; it was filtering robot identity, not report provenance.
- Collection has explicit Auto, Teleop, Endgame and Review navigation, season-specific 2026 timing, and clearly labeled fallback practice timing.
- The scouting network exposes a restricted server-side projection to authenticated team members. Original tables retain their existing RLS.
- Shared fields include supported numeric/boolean metrics, validated selections and numeric position/path arrays. Unrecognized field types, free text, notes, scout identifiers, media and action-history metadata are excluded. Multi-counter object sharing is not yet supported.
- Shared sources and form versions remain separate; custom units are not assumed compatible across teams. Shared data is not written to the app's offline cache. The endpoint checks current opt-out settings on every read, bounds results at 2,000 reports, and explicitly reports truncation.
- Turning sharing off stops subsequent server access. Copies already viewed or independently saved cannot be recalled.
- Privacy wording, marketing FAQ, effective date and legal acceptance version (2026-09-27.1) now describe the implemented default.

## Verification and limits

See evidence/scouting-refresh.json for final executed checks. Tests use restricted request roles and isolated loopback PostgreSQL. Only identified synthetic test organizations are removed.

Initial browser failures exposed an origin comparison against Next's internal host, an exact-label test selector, and tests that needed to open the newly collapsed weight controls. These were fixed without reducing their assertions. The two-team fixture initially omitted its password-login policy; the real API correctly rejected that authentication method.

Production rollout still requires the release gates in STATUS.md. Unfinished original-plan items include cross-device/offline competition load, partner-specific dataset grants, a common schema mapping for combined shared rankings, complete performance benchmarking, and the existing production credentials/operating-cycle checks. No vendor UI certification or “90–100%” score is asserted.
