"use client";

import { Panel, Button, askConfirm } from "../../components/ui";
import {
  AUDIENCE_LABEL,
  CHECKLIST_AUDIENCES,
  type ChecklistAudience,
  type ChecklistItem,
  type EmergencyContact,
  type LogisticsMember,
  type LogisticsTrip,
  type OnDutySlot,
} from "../../lib/logistics";
import { fmtWhen, memberLabel, type RunFn } from "./logistics-model";

export function LogisticsManagePanel({
  orgId,
  canManage,
  trips,
  trip,
  sharedChecklist,
  contacts,
  members,
  activeOnDuty,
  lodgingGaps,
  act,
  busy,
  run,
}: {
  orgId: string;
  canManage: boolean;
  trips: LogisticsTrip[];
  trip: LogisticsTrip | null;
  sharedChecklist: ChecklistItem[];
  contacts: EmergencyContact[];
  members: LogisticsMember[];
  activeOnDuty: OnDutySlot | null;
  lodgingGaps: number;
  act: boolean;
  busy: boolean;
  run: RunFn;
}) {
  if (!canManage) return null;
  return (
    <>
      {lodgingGaps > 0 ? (
        <p className="log-banner warn" role="status">
          {lodgingGaps} room slot{lodgingGaps === 1 ? "" : "s"} still need an occupant.
        </p>
      ) : null}

      <Panel>
        <h2>Checklist planning</h2>
        <p className="app-muted">Seed default student and mentor lists, then customize items per trip.</p>
        <div className="log-inline-actions">
          <Button variant="secondary" type="button" disabled={!act || busy} onClick={() => void run({ action: "seed_checklist", orgId, tripId: trip?.id ?? null }, "seed-chk")}>
            Seed default checklist
          </Button>
        </div>
        <form
          className="log-grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            void run(
              {
                action: "add_checklist_item",
                orgId,
                tripId: String(fd.get("tripId") || "") || null,
                audience: String(fd.get("audience") ?? "student") as ChecklistAudience,
                label: String(fd.get("label") ?? ""),
              },
              "add-chk",
            ).then((saved) => { if (saved !== false) form.reset(); });
          }}
        >
          <select name="tripId" aria-label="Trip" defaultValue={trip?.id ?? ""}>
            <option value="">All trips (shared)</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <select name="audience" aria-label="Checklist audience" defaultValue="student">
            {CHECKLIST_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a]}
              </option>
            ))}
          </select>
          <label className="inline-field-label">New checklist item<input name="label" required /></label>
          <button type="submit" disabled={!act || busy}>
            Add item
          </button>
        </form>
        {sharedChecklist.length === 0 ? (
          <p className="app-muted">No checklist items yet.</p>
        ) : (
          <ul className="log-checklist-list log-checklist-manage">
            {sharedChecklist.map((item) => (
              <li key={item.id}>
                <span>{item.label}</span>
                <small className="app-muted">{AUDIENCE_LABEL[item.audience]}</small>
                <button
                  type="button"
                  className="log-link danger"
                  disabled={!act || busy}
                  onClick={() => {
                    if (confirm(`Remove "${item.label}"?`)) {
                      void run({ action: "delete_checklist_item", orgId, id: item.id }, `del-chk:${item.id}`);
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2>Emergency contacts (edit)</h2>
        <form
          id="log-add-contact"
          className="log-grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            void run(
              {
                action: "upsert_contact",
                orgId,
                name: String(fd.get("name") ?? ""),
                roleLabel: String(fd.get("roleLabel") ?? ""),
                phone: String(fd.get("phone") ?? ""),
                email: String(fd.get("email") ?? ""),
                notes: String(fd.get("notes") ?? ""),
                isPrimary: fd.get("isPrimary") === "on",
                sortOrder: Number(fd.get("sortOrder") ?? 0),
              },
              "contact",
            ).then((saved) => { if (saved !== false) form.reset(); });
          }}
        >
          <label className="inline-field-label">Name<input name="name" required /></label>
          <label className="inline-field-label">Contact role<input name="roleLabel" /></label>
          <label className="inline-field-label">Phone<input name="phone" /></label>
          <label className="inline-field-label">Email<input name="email" /></label>
          <label className="inline-field-label">Display order<input name="sortOrder" type="number" defaultValue={0} /></label>
          <label className="log-check-inline">
            <input name="isPrimary" type="checkbox" /> Primary contact
          </label>
          <label className="inline-field-label">Notes<textarea name="notes" rows={2} /></label>
          <button type="submit" disabled={!act || busy}>
            Save contact
          </button>
        </form>
        {contacts.map((contact) => (
          <div key={contact.id} className="log-manage-row">
            <span>
              <strong>{contact.name}</strong> {contact.phone}
            </span>
            <button
              type="button"
              className="log-link danger"
              disabled={!act || busy}
              onClick={async () => { if (await askConfirm({ title: "Delete this contact?", body: `“${contact.name}” is deleted from logistics contacts.`, confirmLabel: "Delete contact", tone: "destructive" })) void run({ action: "delete_contact", orgId, id: contact.id }, `del-contact:${contact.id}`); }}
            >
              Delete
            </button>
          </div>
        ))}
      </Panel>

      <Panel>
        <h2>On-duty mentors</h2>
        <form
          className="log-grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            const starts = String(fd.get("startsAt") ?? "");
            const ends = String(fd.get("endsAt") ?? "");
            void run(
              {
                action: "upsert_on_duty",
                orgId,
                tripId: String(fd.get("tripId") || "") || null,
                mentorUserId: String(fd.get("mentorUserId") || "") || null,
                mentorName: String(fd.get("mentorName") ?? ""),
                phone: String(fd.get("phone") ?? ""),
                startsAt: starts ? new Date(starts).toISOString() : "",
                endsAt: ends ? new Date(ends).toISOString() : null,
                locationNote: String(fd.get("locationNote") ?? ""),
                notes: String(fd.get("notes") ?? ""),
              },
              "onduty",
            ).then((saved) => { if (saved !== false) form.reset(); });
          }}
        >
          <select name="tripId" aria-label="Trip" defaultValue={trip?.id ?? ""}>
            <option value="">Any trip</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <select name="mentorUserId" aria-label="Mentor" defaultValue="">
            <option value="">Pick mentor (optional)</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
          <label className="inline-field-label">Display name override<input name="mentorName" /></label>
          <label className="inline-field-label">Phone<input name="phone" /></label>
          <label className="inline-field-label">Start time<input name="startsAt" type="datetime-local" required /></label>
          <label className="inline-field-label">End time<input name="endsAt" type="datetime-local" /></label>
          <label className="inline-field-label">Location (pit, hotel lobby…)<input name="locationNote" /></label>
          <label className="inline-field-label">Notes<textarea name="notes" rows={2} /></label>
          <button type="submit" disabled={!act || busy}>
            Save on-duty slot
          </button>
        </form>
        {activeOnDuty ? (
          <div className="log-manage-row">
            <span>
              {activeOnDuty.mentorName || "On duty"} · {fmtWhen(activeOnDuty.startsAt)}
            </span>
            <button
              type="button"
              className="log-link danger"
              disabled={!act || busy}
              onClick={async () => { if (await askConfirm({ title: "Remove the on-duty slot?", body: `${activeOnDuty.mentorName} is no longer listed as on duty.`, confirmLabel: "Remove slot", tone: "destructive" })) void run({ action: "delete_on_duty", orgId, id: activeOnDuty.id }, `del-od:${activeOnDuty.id}`); }}
            >
              Remove active slot
            </button>
          </div>
        ) : (
          <p className="app-muted">No on-duty slot is active right now. Add one above before travel.</p>
        )}
      </Panel>
    </>
  );
}
