"use client";

import { EmptyState, Panel, ToolStrip } from "../../components/ui";
import {
  TRAVEL_LEG_KINDS,
  TRAVEL_LEG_LABELS,
  type Hotel,
  type LogisticsMember,
  type LogisticsTrip,
  type TravelLeg,
  type TravelLegKind,
} from "../../lib/logistics";
import { fmtWhen, memberLabel, type RunFn } from "./logistics-model";

export function LogisticsTripsPanel({
  orgId,
  canManage,
  trips,
  trip,
  legs,
  members,
  act,
  busy,
  run,
  onSelectTrip,
}: {
  orgId: string;
  canManage: boolean;
  trips: LogisticsTrip[];
  trip: LogisticsTrip | null;
  legs: TravelLeg[];
  members: LogisticsMember[];
  act: boolean;
  busy: boolean;
  run: RunFn;
  onSelectTrip: (id: string) => void;
}) {
  return (
    <Panel id="logistics-create-trip" className="log-trip-panel">
      <div className="log-section-head">
        <div>
          <h2>Trips, hotels, and travel times</h2>
          <p className="app-muted">
            Publish leave, hotel, venue, and return times. Legs sync to Team Calendar when configured. Counts reflect
            saved lodging only.
          </p>
        </div>
      </div>

      {trips.length ? (
        <ToolStrip
          aria-label="Trips"
          value={trip?.id ?? trips[0]?.id ?? ""}
          onChange={onSelectTrip}
          items={trips.map((t) => ({ id: t.id, label: t.title }))}
        />
      ) : null}

      {canManage ? (
        <form
          className="log-grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void run(
              {
                action: "create_trip",
                orgId,
                title: String(fd.get("title") ?? ""),
                eventKey: String(fd.get("eventKey") ?? "") || null,
                venueName: String(fd.get("venueName") ?? ""),
                venueAddress: String(fd.get("venueAddress") ?? ""),
                travelNotes: String(fd.get("travelNotes") ?? ""),
                transportNotes: String(fd.get("transportNotes") ?? ""),
                startsOn: String(fd.get("startsOn") ?? "") || null,
                endsOn: String(fd.get("endsOn") ?? "") || null,
              },
              "trip",
            ).then(() => e.currentTarget.reset());
          }}
        >
          <input name="title" placeholder="Trip title" required />
          <input name="eventKey" placeholder="Official event key (optional)" />
          <input name="venueName" placeholder="Venue name" />
          <input name="venueAddress" placeholder="Venue address" />
          <input name="startsOn" type="date" />
          <input name="endsOn" type="date" />
          <textarea name="travelNotes" placeholder="Travel notes" rows={2} />
          <textarea name="transportNotes" placeholder="Transport notes" rows={2} />
          <button type="submit" disabled={!act || busy}>
            Add trip
          </button>
        </form>
      ) : null}

      {canManage && trip ? (
        <div className="log-inline-actions">
          <button
            type="button"
            className="log-link danger"
            disabled={!act || busy}
            onClick={() => {
              if (confirm(`Delete trip "${trip.title}" and its hotels/legs?`)) {
                void run({ action: "delete_trip", orgId, id: trip.id }, `del-trip:${trip.id}`);
              }
            }}
          >
            Delete selected trip
          </button>
        </div>
      ) : null}

      {trip ? (
        <div className="log-trip-block">
          <header className="log-trip-meta">
            <h3>{trip.title}</h3>
            {(trip.venueName || trip.startsOn) && (
              <p className="app-muted">{[trip.venueName, trip.startsOn, trip.endsOn].filter(Boolean).join(" · ")}</p>
            )}
            {trip.travelNotes ? <p className="app-muted">{trip.travelNotes}</p> : null}
          </header>

          <section className="log-subpanel" aria-label="Hotels and rooming">
            <div className="log-subpanel-head">
              <h4>Hotels and rooming</h4>
              <span className="app-muted">
                {trip.hotels.length} hotel{trip.hotels.length === 1 ? "" : "s"}
              </span>
            </div>
            {trip.hotels.length === 0 ? (
              <EmptyState
                soft
                title="No hotels for this trip"
                description={
                  canManage
                    ? "Add the hotel block and rooming list so students can see their room."
                    : "Mentors add lodging when the room block is confirmed."
                }
              />
            ) : (
              trip.hotels.map((hotel) => (
                <HotelBlock
                  key={hotel.id}
                  hotel={hotel}
                  orgId={orgId}
                  members={members}
                  canManage={canManage}
                  act={act}
                  busy={busy}
                  run={run}
                />
              ))
            )}

            {canManage ? (
              <form
                className="log-grid-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  void run(
                    {
                      action: "create_hotel",
                      orgId,
                      tripId: trip.id,
                      name: String(fd.get("name") ?? ""),
                      address: String(fd.get("address") ?? ""),
                      phone: String(fd.get("phone") ?? ""),
                      confirmationCode: String(fd.get("confirmationCode") ?? ""),
                      checkInAt: String(fd.get("checkInAt") ?? "") || null,
                      checkOutAt: String(fd.get("checkOutAt") ?? "") || null,
                      roomBlockNotes: String(fd.get("roomBlockNotes") ?? ""),
                      notes: String(fd.get("notes") ?? ""),
                    },
                    `hotel:${trip.id}`,
                  ).then(() => e.currentTarget.reset());
                }}
              >
                <input name="name" placeholder="Hotel name" required />
                <input name="address" placeholder="Address" />
                <input name="phone" placeholder="Phone" />
                <input name="confirmationCode" placeholder="Confirmation code" />
                <input name="checkInAt" type="datetime-local" />
                <input name="checkOutAt" type="datetime-local" />
                <textarea name="roomBlockNotes" placeholder="Room block notes" rows={2} />
                <button type="submit" disabled={!act || busy}>
                  Add hotel
                </button>
              </form>
            ) : null}
          </section>

          <section className="log-subpanel" aria-label="Travel legs">
            <div className="log-subpanel-head">
              <h4>Get there and back</h4>
              <span className="app-muted">
                {legs.length} travel time{legs.length === 1 ? "" : "s"}
              </span>
            </div>
            {legs.length === 0 ? (
              <EmptyState
                soft
                title="No timed legs yet"
                description={
                  canManage
                    ? "Add leave / arrive times so they show on My Day and Team Calendar."
                    : "Mentors publish leave and arrive times before departure."
                }
              />
            ) : (
              <ol className="logistics-timeline">
                {legs.map((leg) => (
                  <li key={leg.id}>
                    <span className="logistics-timeline-kind">{TRAVEL_LEG_LABELS[leg.kind]}</span>
                    <strong>{fmtWhen(leg.startsAt)}</strong>
                    <span>
                      {leg.title}
                      {leg.meetingPoint ? ` · ${leg.meetingPoint}` : ""}
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className="log-link danger"
                        disabled={!act || busy}
                        onClick={() => {
                          if (confirm(`Remove "${leg.title}"?`)) {
                            void run({ action: "delete_travel_leg", orgId, id: leg.id }, `del-leg:${leg.id}`);
                          }
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            {canManage ? (
              <form
                className="log-grid-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const starts = String(fd.get("startsAt") ?? "");
                  void run(
                    {
                      action: "upsert_travel_leg",
                      orgId,
                      tripId: trip.id,
                      kind: String(fd.get("kind") ?? "depart_home") as TravelLegKind,
                      title: String(fd.get("title") ?? ""),
                      startsAt: starts ? new Date(starts).toISOString() : "",
                      endsAt: null,
                      location: String(fd.get("location") ?? ""),
                      meetingPoint: String(fd.get("meetingPoint") ?? ""),
                      notes: String(fd.get("notes") ?? ""),
                      subteamId: null,
                      sortOrder: 0,
                    },
                    "leg",
                  ).then(() => e.currentTarget.reset());
                }}
              >
                <select name="kind" defaultValue="depart_home">
                  {TRAVEL_LEG_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {TRAVEL_LEG_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input name="title" placeholder="Title (optional)" />
                <input name="startsAt" type="datetime-local" required />
                <input name="meetingPoint" placeholder="Meeting point" />
                <input name="location" placeholder="Location" />
                <button type="submit" disabled={!act || busy}>
                  Add travel time
                </button>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}
    </Panel>
  );
}

function HotelBlock({
  hotel,
  orgId,
  members,
  canManage,
  act,
  busy,
  run,
}: {
  hotel: Hotel;
  orgId: string;
  members: LogisticsMember[];
  canManage: boolean;
  act: boolean;
  busy: boolean;
  run: RunFn;
}) {
  const unassigned = hotel.rooms.filter((room) => !room.occupantUserId && !room.occupantName.trim()).length;
  return (
    <div className="log-hotel-block">
      <div className="log-hotel-head">
        <div>
          <strong>{hotel.name}</strong>
          {hotel.confirmationCode ? <span className="app-muted"> · Conf #{hotel.confirmationCode}</span> : null}
        </div>
        {canManage ? (
          <button
            type="button"
            className="log-link danger"
            disabled={!act || busy}
            onClick={() => {
              if (confirm(`Delete hotel "${hotel.name}"?`)) {
                void run({ action: "delete_hotel", orgId, id: hotel.id }, `del-hotel:${hotel.id}`);
              }
            }}
          >
            Delete hotel
          </button>
        ) : null}
      </div>
      {hotel.address ? <p className="app-muted">{hotel.address}</p> : null}
      {hotel.phone ? (
        <p>
          <a href={`tel:${hotel.phone.replace(/\s/g, "")}`}>{hotel.phone}</a>
        </p>
      ) : null}
      {(hotel.checkInAt || hotel.checkOutAt) && (
        <p className="app-muted">
          Check-in {fmtWhen(hotel.checkInAt)} · Check-out {fmtWhen(hotel.checkOutAt)}
        </p>
      )}
      {hotel.roomBlockNotes ? <p className="app-muted">{hotel.roomBlockNotes}</p> : null}
      {hotel.rooms.length === 0 ? (
        <p className="app-muted">No rooms in the block yet.</p>
      ) : (
        <>
          {unassigned > 0 && canManage ? (
            <p className="log-banner warn" role="status">
              {unassigned} unassigned room slot{unassigned === 1 ? "" : "s"} in this hotel.
            </p>
          ) : null}
          <ul className="logistics-list">
            {hotel.rooms.map((room) => (
              <li key={room.id}>
                <strong>Room {room.roomLabel}</strong>
                <span>
                  {room.occupantName || room.occupantUserId
                    ? memberLabel(
                        members.find((m) => m.userId === room.occupantUserId) ?? {
                          userId: room.occupantUserId ?? "",
                          name: room.occupantName,
                          email: null,
                          role: "",
                        },
                      )
                    : "Unassigned"}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    className="log-link danger"
                    disabled={!act || busy}
                    onClick={() => void run({ action: "delete_room", orgId, id: room.id }, `del-room:${room.id}`)}
                  >
                    Remove room
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {canManage ? (
        <form
          className="log-grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void run(
              {
                action: "upsert_room",
                orgId,
                hotelId: hotel.id,
                roomLabel: String(fd.get("roomLabel") ?? ""),
                occupantUserId: String(fd.get("occupantUserId") || "") || null,
                occupantName: String(fd.get("occupantName") ?? ""),
                notes: String(fd.get("notes") ?? ""),
              },
              `room:${hotel.id}`,
            ).then(() => e.currentTarget.reset());
          }}
        >
          <input name="roomLabel" placeholder="Room label" required />
          <select name="occupantUserId" defaultValue="">
            <option value="">Assign member (optional)</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
          <input name="occupantName" placeholder="Or type occupant name" />
          <input name="notes" placeholder="Notes" />
          <button type="submit" disabled={!act || busy}>
            Add / update room
          </button>
        </form>
      ) : null}
    </div>
  );
}
