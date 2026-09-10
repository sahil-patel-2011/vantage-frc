"use client";

import { EmptyState, Panel } from "../../components/ui";
import {
  AUDIENCE_LABEL,
  type ChecklistItem,
  type EmergencyContact,
  type MyLodging,
  type MyTripStop,
  type OnDutySlot,
} from "../../lib/logistics";
import { fmtWhen } from "./logistics-model";

export type ChecklistStats = { done: number; total: number; percent: number };

export function LogisticsDayPanel({
  canManage,
  nextLeg,
  myTrip,
  myLodging,
  lodgingLine,
  activeOnDuty,
  viewerChecklist,
  checklistStats,
  contacts,
  act,
  busy,
  onToggleChecklist,
}: {
  canManage: boolean;
  nextLeg: MyTripStop | null;
  myTrip: MyTripStop[];
  myLodging: MyLodging | null;
  lodgingLine: string | null;
  activeOnDuty: OnDutySlot | null;
  viewerChecklist: ChecklistItem[];
  checklistStats: ChecklistStats;
  contacts: EmergencyContact[];
  act: boolean;
  busy: boolean;
  onToggleChecklist: (item: ChecklistItem, checked: boolean) => void;
}) {
  return (
    <>
      {nextLeg ? (
        <Panel className="logistics-mine">
          <span className="log-kicker">Next on my trip</span>
          <h2>
            {nextLeg.label}: {fmtWhen(nextLeg.startsAt)}
          </h2>
          <p className="app-muted">
            {nextLeg.title}
            {nextLeg.meetingPoint ? ` · Meet at ${nextLeg.meetingPoint}` : ""}
            {nextLeg.location ? ` · ${nextLeg.location}` : ""}
          </p>
        </Panel>
      ) : !canManage ? (
        <Panel>
          <span className="log-kicker">Next on my trip</span>
          <p className="app-muted">No upcoming travel times published yet.</p>
        </Panel>
      ) : null}

      {!canManage && myTrip.length > 0 ? (
        <Panel>
          <span className="log-kicker">My trip</span>
          <h2>When to leave and arrive</h2>
          <ol className="logistics-timeline">
            {myTrip.map((stop) => (
              <li key={stop.id} className={nextLeg?.id === stop.id ? "next" : undefined}>
                <span className="logistics-timeline-kind">{stop.label}</span>
                <strong>{fmtWhen(stop.startsAt)}</strong>
                <span>
                  {stop.title}
                  {stop.meetingPoint ? ` · ${stop.meetingPoint}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {myLodging && lodgingLine ? (
        <Panel className="logistics-mine">
          <span className="log-kicker">My lodging</span>
          <h2>{lodgingLine}</h2>
          <p className="app-muted">{myLodging.tripTitle}</p>
          {myLodging.hotelAddress ? <p>{myLodging.hotelAddress}</p> : null}
          {myLodging.hotelPhone ? (
            <p>
              <a href={`tel:${myLodging.hotelPhone.replace(/\s/g, "")}`}>{myLodging.hotelPhone}</a>
            </p>
          ) : null}
          {(myLodging.checkInAt || myLodging.checkOutAt) && (
            <p className="app-muted">
              Check-in {fmtWhen(myLodging.checkInAt)} · Check-out {fmtWhen(myLodging.checkOutAt)}
            </p>
          )}
        </Panel>
      ) : !canManage ? (
        <Panel>
          <span className="log-kicker">My lodging</span>
          <p className="app-muted">
            No room assignment yet. Mentors add hotels and rooming lists when travel is booked.
          </p>
        </Panel>
      ) : null}

      {activeOnDuty ? (
        <Panel>
          <span className="log-kicker">Mentor on duty</span>
          <h2>{activeOnDuty.mentorName || "On-duty mentor"}</h2>
          <p>
            {fmtWhen(activeOnDuty.startsAt)}
            {activeOnDuty.endsAt ? ` – ${fmtWhen(activeOnDuty.endsAt)}` : ""}
            {activeOnDuty.locationNote ? ` · ${activeOnDuty.locationNote}` : ""}
          </p>
          {activeOnDuty.phone ? (
            <p>
              <a href={`tel:${activeOnDuty.phone.replace(/\s/g, "")}`}>{activeOnDuty.phone}</a>
            </p>
          ) : null}
          {activeOnDuty.notes ? <p className="app-muted">{activeOnDuty.notes}</p> : null}
        </Panel>
      ) : !canManage ? (
        <Panel>
          <span className="log-kicker">Mentor on duty</span>
          <p className="app-muted">No on-duty schedule posted yet.</p>
        </Panel>
      ) : null}

      <Panel className="log-checklist">
        <div className="log-section-head">
          <div>
            <h2>Day-of checklist</h2>
            <p className="app-muted">Check items off as you go. Mentors see mentor items; students see student items.</p>
          </div>
          {checklistStats.total > 0 ? (
            <div className="log-progress" aria-label={`${checklistStats.percent}% complete`}>
              <div className="log-progress-bar" style={{ width: `${checklistStats.percent}%` }} />
              <span>
                {checklistStats.done}/{checklistStats.total}
              </span>
            </div>
          ) : null}
        </div>
        {viewerChecklist.length === 0 ? (
          <EmptyState
            soft
            title="Nothing on your checklist yet"
            description={canManage ? "Seed defaults or add items below." : "Mentors add checklist items before the trip."}
          />
        ) : (
          <ul className="log-checklist-list">
            {viewerChecklist.map((item) => (
              <li key={item.id}>
                <label className={item.checked ? "log-check-done" : undefined}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={!act || busy}
                    onChange={(event) => onToggleChecklist(item, event.target.checked)}
                  />
                  <span>{item.label}</span>
                  <small className="app-muted">{AUDIENCE_LABEL[item.audience]}</small>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2>Emergency contacts</h2>
        <p className="app-muted">Call these mentors first if something goes wrong on the trip.</p>
        {contacts.length === 0 ? (
          <EmptyState soft title="No contacts posted yet" description="Mentors add primary phone numbers before travel." />
        ) : (
          <ul className="logistics-list">
            {[...contacts]
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
              .map((contact) => (
                <li key={contact.id} className={contact.isPrimary ? "log-contact-primary" : undefined}>
                  <strong>{contact.name}</strong>
                  {contact.roleLabel ? <span>{contact.roleLabel}</span> : null}
                  {contact.phone ? <a href={`tel:${contact.phone.replace(/\s/g, "")}`}>{contact.phone}</a> : null}
                  {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                  {contact.notes ? <p className="app-muted">{contact.notes}</p> : null}
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
