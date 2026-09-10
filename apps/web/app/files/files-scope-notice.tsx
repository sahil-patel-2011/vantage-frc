"use client";

import { Panel } from "../../components/ui";

/**
 * The paragraph that makes this product trustworthy enough for a team of
 * minors. It is at the top of the page, not in a settings screen, because the
 * person who needs to read it is the fifteen-year-old deciding where to put
 * something.
 */
export function ScopeNotice() {
  return (
    <Panel className="drive-scope-notice">
      <h2>Who can see what</h2>
      <p>
        <strong>My files is yours.</strong> Nobody else on the team can open it — not other students,
        not mentors, not the team owner. That cannot be turned off. The only way something leaves
        your space is a share you create yourself.
      </p>
      <p>
        <strong>Team files belong to the team.</strong> Every member can open them. Owners and admins
        can also see every share link anyone has created on team files, so a link that leaves the team
        is never invisible to the people responsible for it — but they still cannot see inside
        anyone&rsquo;s personal space.
      </p>
      <p>
        <strong>A share link works without a Vantage account.</strong> Anyone holding the link can open
        what it points at, until it expires or you revoke it. Treat it like a key, not like a name on
        a list.
      </p>
    </Panel>
  );
}
