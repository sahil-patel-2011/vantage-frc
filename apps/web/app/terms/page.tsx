import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { LEGAL_DOC_VERSION, LEGAL_EFFECTIVE_DATE } from "../../lib/legal";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Terms of Service — Vantage",
  description:
    "Terms for using Vantage, the invite-only competition operations platform for FIRST Robotics Competition teams.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <div className="marketing-site marketing-lux legal-page">
      <SiteHeader />
      <main className="legal-content">
        <p className="legal-kicker">LEGAL</p>
        <h1>Terms of Service — Vantage</h1>
        <p className="legal-meta">
          Effective {LEGAL_EFFECTIVE_DATE} · Version {LEGAL_DOC_VERSION}
        </p>
        <p>
          These Terms govern access to Vantage, an operations platform for FIRST Robotics Competition teams. By
          creating an account, accepting an invitation, or using Vantage, you agree to these Terms and the Privacy
          Policy.
        </p>
        <h2>Access and team accounts</h2>
        <p>
          Vantage is a closed-access service. Accounts may require verification, onboarding, and approval by a team
          owner or administrator. An invitation, waitlist request, or team number does not guarantee access. Each
          organization is a separate workspace; members may use only data they are authorized to access.
        </p>
        <h2>Responsible use</h2>
        <ul>
          <li>Provide accurate information and protect your credentials.</li>
          <li>Use Vantage lawfully and safely, consistent with FIRST rules and your school or organization policies.</li>
          <li>
            Do not bypass access controls, interfere with the service, upload malicious content, or access another
            person&apos;s data without authorization.
          </li>
          <li>Owners and administrators manage team membership, permissions, and submitted content.</li>
        </ul>
        <h2>Team data and permissions</h2>
        <p>
          Your team retains rights in its content. You authorize Vantage to host, process, and display it only to
          operate and improve the service for your team. Vantage uses organization-scoped controls and row-level
          database policies to separate workspaces, but no system can guarantee perfect security.
        </p>
        <h2>AI features, credits, and BYOK</h2>
        <p>
          AI features are metered against the organization&apos;s plan or credit limits. Generated output can be
          incomplete or incorrect and must be reviewed before use for scouting, strategy, engineering, fundraising, or
          safety decisions. A team supplying a bring-your-own key is responsible for its provider account, charges, and
          permitted use; Vantage uses that key only for the requested integration.
        </p>
        <h2>Availability and changes</h2>
        <p>
          We make reasonable efforts to operate Vantage reliably but do not promise uninterrupted or error-free
          service. Features may change, suspend, or end to protect users, comply with law, or improve the service. To
          the extent permitted by law, Vantage is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo;
        </p>
        <h2>Termination</h2>
        <p>
          We may suspend or terminate access for misuse, security risk, or a violation of these Terms. Continued use
          after an update may require a new explicit acceptance.
        </p>
        <h2>Contact</h2>
        <p>
          Questions about these Terms: <a href="mailto:privacy@vantagefrc.com">privacy@vantagefrc.com</a>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
