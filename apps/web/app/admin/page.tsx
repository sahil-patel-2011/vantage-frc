import AdminClient from "./admin-client";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">VANTAGE / ADMIN</div>
        <nav>
          <a className="active" href="/admin">
            Overview
          </a>
          <span style={{ display: "block", padding: 10, color: "#5c6a70", cursor: "default" }}>Organizations (soon)</span>
          <span style={{ display: "block", padding: 10, color: "#5c6a70", cursor: "default" }}>Usage (soon)</span>
          <span style={{ display: "block", padding: 10, color: "#5c6a70", cursor: "default" }}>Audit log (soon)</span>
          <a href="/admin/commercial">Commercial</a>
          <a href="/admin/connectors">Connectors</a>
          <a href="/admin/models">Models</a>
        </nav>
      </aside>
      <AdminClient />
    </div>
  );
}
