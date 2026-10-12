import { PageHeader } from "../../../components/ui";
import { MORE_PAGES } from "../../../lib/admin/admin-nav";
import { OutageContactsLine } from "../outage-contacts";
import "../admin-console.css";

export const metadata = {
  title: "More · Platform admin",
};

/**
 * Everything the operator opens now and then, in one quiet place: lists, connectors, releases,
 * and the outage contact list the down alert emails.
 */
export default function AdminMorePage() {
  return (
    <main className="module-page admin-control ac-page">
      <PageHeader title="More" description="Pages you open now and then." />
      <ul className="ac-list">
        {MORE_PAGES.map((page) => (
          <li key={page.href}>
            <a className="ac-row" href={page.href}>
              <span className="ac-row-main">
                <strong>{page.label}</strong>
                <small>{page.detail}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <section className="ac-section" aria-labelledby="more-outage">
        <div className="ac-section-head">
          <h2 id="more-outage">Outage contacts</h2>
        </div>
        <OutageContactsLine />
      </section>
    </main>
  );
}
