import { describe, expect, it } from "vitest";
import { alumniStatusLabel, mentorSlotStatusLabel, summarizeAlumniNetwork } from "./index";
import { computeAlumniNetworkView } from "./compute-alumni-network";
import type { AlumniProfile, MentorSlot } from "./types";

let seq = 0;
function profile(overrides: Partial<AlumniProfile> = {}): AlumniProfile {
  seq += 1;
  return {
    id: `profile-${seq}`,
    fullName: `Alum ${seq}`,
    graduationYear: 2020,
    roleWhileActive: "Programming Lead",
    currentOccupation: "Software Engineer",
    currentLocation: "Denver, CO",
    email: `alum${seq}@example.com`,
    phone: null,
    linkedinUrl: null,
    mentorAvailable: false,
    mentorFocusAreas: [],
    bio: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function slot(overrides: Partial<MentorSlot> = {}): MentorSlot {
  seq += 1;
  return {
    id: `slot-${seq}`,
    profileId: "profile-1",
    profileName: "Alum 1",
    topic: "CAD review",
    availableFrom: "2026-08-01",
    availableTo: "2026-08-31",
    notes: null,
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Minimal PoolClient stub: only `query` is called by computeAlumniNetworkView.
function mockClient(responses: unknown[][]) {
  let call = 0;
  return {
    query: async () => {
      const rows = responses[call] ?? [];
      call += 1;
      return { rows, rowCount: rows.length };
    },
  } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("summarizeAlumniNetwork", () => {
  it("returns an all-zero summary for no profiles or slots", () => {
    const s = summarizeAlumniNetwork([], []);
    expect(s.totalAlumni).toBe(0);
    expect(s.activeAlumni).toBe(0);
    expect(s.mentorsAvailable).toBe(0);
    expect(s.openMentorSlots).toBe(0);
    expect(s.byFocusArea).toEqual([]);
    expect(s.byDecade).toEqual([]);
  });

  it("tallies mentor availability, focus areas, decades, and open slots", () => {
    const profiles = [
      profile({ status: "active", mentorAvailable: true, mentorFocusAreas: ["CAD", "Programming"], graduationYear: 2018 }),
      profile({ status: "active", mentorAvailable: true, mentorFocusAreas: ["CAD"], graduationYear: 2021 }),
      profile({ status: "inactive", mentorAvailable: false, mentorFocusAreas: [], graduationYear: 2011 }),
    ];
    const slots = [slot({ status: "open" }), slot({ status: "booked" }), slot({ status: "open" })];

    const s = summarizeAlumniNetwork(profiles, slots);
    expect(s.totalAlumni).toBe(3);
    expect(s.activeAlumni).toBe(2);
    expect(s.mentorsAvailable).toBe(2);
    expect(s.openMentorSlots).toBe(2);
    const cad = s.byFocusArea.find((row) => row.focusArea === "CAD");
    expect(cad?.count).toBe(2);
    expect(s.byDecade.find((row) => row.decade === "2010s")?.count).toBe(2);
    expect(s.byDecade.find((row) => row.decade === "2020s")?.count).toBe(1);
  });
});

describe("alumniStatusLabel / mentorSlotStatusLabel", () => {
  it("labels every status value", () => {
    expect(alumniStatusLabel("active")).toBe("Active");
    expect(alumniStatusLabel("inactive")).toBe("Inactive");
    expect(mentorSlotStatusLabel("open")).toBe("Open");
    expect(mentorSlotStatusLabel("booked")).toBe("Booked");
    expect(mentorSlotStatusLabel("completed")).toBe("Completed");
    expect(mentorSlotStatusLabel("cancelled")).toBe("Cancelled");
  });
});

describe("computeAlumniNetworkView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient([[]]); // resolveOrg membership query -> no rows
    const view = await computeAlumniNetworkView(client, { userId: "user-1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with summarized directory over mock rows", async () => {
    const client = mockClient([
      [{ orgId: "org-1", teamNumber: 254 }], // resolveOrg
      [
        {
          id: "profile-1",
          fullName: "Ada Lovelace",
          graduationYear: 2019,
          roleWhileActive: "Captain",
          currentOccupation: "Robotics Engineer",
          currentLocation: "Boston, MA",
          email: "ada@example.com",
          phone: null,
          linkedinUrl: null,
          mentorAvailable: true,
          mentorFocusAreas: ["CAD", "Leadership"],
          bio: null,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ], // profiles
      [
        {
          id: "slot-1",
          profileId: "profile-1",
          profileName: "Ada Lovelace",
          topic: "Chassis design office hours",
          availableFrom: "2026-08-01",
          availableTo: "2026-08-15",
          notes: null,
          status: "open",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ], // mentor slots
    ]);

    const view = await computeAlumniNetworkView(client, { userId: "user-1", requestedOrg: "org-1" });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe("org-1");
      expect(view.teamNumber).toBe(254);
      expect(view.profiles).toHaveLength(1);
      expect(view.profiles[0]?.mentorFocusAreas).toEqual(["CAD", "Leadership"]);
      expect(view.mentorSlots).toHaveLength(1);
      expect(view.summary.totalAlumni).toBe(1);
      expect(view.summary.mentorsAvailable).toBe(1);
      expect(view.summary.openMentorSlots).toBe(1);
    }
  });
});
