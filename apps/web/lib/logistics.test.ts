import { describe, expect, it } from "vitest";
import {
  TRAVEL_LEG_LABELS,
  buildMyTrip,
  checklistProgress,
  countLodgingGaps,
  countLodgingGapsInTrips,
  filterChecklistForViewer,
  findMyLodging,
  myRoomForUser,
  pickNextTravelLeg,
  roomNeedsOccupant,
  type ChecklistItem,
  type LogisticsTrip,
} from "./logistics";

const sampleTrip = (): LogisticsTrip => ({
  id: "trip-1",
  title: "District event",
  eventKey: "2026nyli",
  venueName: "Arena",
  venueAddress: "",
  travelNotes: "",
  transportNotes: "",
  startsOn: "2026-03-14",
  endsOn: "2026-03-16",
  hotels: [
    {
      id: "h1",
      tripId: "trip-1",
      name: "Inn",
      address: "1 Main",
      phone: "555",
      confirmationCode: "ABC",
      checkInAt: null,
      checkOutAt: null,
      roomBlockNotes: "",
      notes: "",
      rooms: [
        {
          id: "r1",
          hotelId: "h1",
          roomLabel: "101",
          occupantUserId: "u1",
          occupantName: "A",
          notes: "",
        },
        {
          id: "r2",
          hotelId: "h1",
          roomLabel: "102",
          occupantUserId: null,
          occupantName: "",
          notes: "",
        },
      ],
    },
  ],
  travelLegs: [
    {
      id: "leg-1",
      tripId: "trip-1",
      kind: "depart_home",
      title: "Bus leaves school",
      startsAt: "2099-03-14T12:00:00.000Z",
      endsAt: null,
      location: "School",
      meetingPoint: "Lot A",
      notes: "",
      subteamId: null,
      subteamName: null,
      calendarEventId: null,
      sortOrder: 0,
    },
  ],
});

describe("logistics lodging helpers", () => {
  it("treats empty occupant slots as lodging gaps", () => {
    expect(roomNeedsOccupant({ occupantUserId: null, occupantName: "" })).toBe(true);
    expect(roomNeedsOccupant({ occupantUserId: "u1", occupantName: "" })).toBe(false);
    expect(roomNeedsOccupant({ occupantUserId: null, occupantName: "Alex" })).toBe(false);
    expect(
      countLodgingGaps([
        { occupantUserId: null, occupantName: "" },
        { occupantUserId: null, occupantName: "Sam" },
        { occupantUserId: "u2", occupantName: "" },
      ]),
    ).toBe(1);
  });

  it("finds the signed-in user's room", () => {
    const rooms = [
      {
        id: "r1",
        hotelId: "h1",
        hotelName: "Inn",
        roomLabel: "101",
        occupantUserId: "u1",
        occupantName: "A",
        notes: "",
      },
      {
        id: "r2",
        hotelId: "h1",
        hotelName: "Inn",
        roomLabel: "102",
        occupantUserId: "u2",
        occupantName: "B",
        notes: "",
      },
    ];
    expect(myRoomForUser(rooms, "u2")?.roomLabel).toBe("102");
    expect(myRoomForUser(rooms, "missing")).toBeNull();
  });

  it("counts real lodging gaps from trips without inventing rooms", () => {
    expect(countLodgingGapsInTrips([sampleTrip()])).toBe(1);
    expect(countLodgingGapsInTrips([])).toBe(0);
  });

  it("finds my lodging from assigned rooms only", () => {
    const lodging = findMyLodging([sampleTrip()], "u1");
    expect(lodging?.roomLabel).toBe("101");
    expect(lodging?.hotelName).toBe("Inn");
    expect(findMyLodging([sampleTrip()], "missing")).toBeNull();
  });
});

describe("logistics travel helpers", () => {
  it("builds my trip stops from published legs only", () => {
    const stops = buildMyTrip([sampleTrip()], [], "2026nyli");
    expect(stops).toHaveLength(1);
    expect(stops[0]?.label).toBe(TRAVEL_LEG_LABELS.depart_home);
    expect(stops[0]?.meetingPoint).toBe("Lot A");
  });

  it("picks the next upcoming leg without demo placeholders", () => {
    const stops = buildMyTrip([sampleTrip()], [], null);
    const next = pickNextTravelLeg(stops, new Date("2026-01-01T00:00:00.000Z"));
    expect(next?.id).toBe("leg-1");
    expect(Object.values(TRAVEL_LEG_LABELS).every((label) => !/demo/i.test(label))).toBe(true);
  });

  it("filters checklist by viewer role and tracks progress from real checks", () => {
    const items: ChecklistItem[] = [
      { id: "1", tripId: null, audience: "student", label: "Badge", sortOrder: 0, checked: true, checkedAt: null },
      { id: "2", tripId: null, audience: "mentor", label: "Roster", sortOrder: 1, checked: false, checkedAt: null },
      { id: "3", tripId: null, audience: "all", label: "Phone", sortOrder: 2, checked: false, checkedAt: null },
    ];
    const student = filterChecklistForViewer(items, "student");
    expect(student.map((i) => i.id)).toEqual(["1", "3"]);
    expect(checklistProgress(student)).toEqual({ total: 2, done: 1, percent: 50 });
  });
});
