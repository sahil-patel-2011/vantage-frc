// Alumni network domain types. Pure data shapes — no I/O, no framework imports.
// Tracks graduated members who remain reachable as mentors, plus the mentor-availability
// windows those alumni have offered (topic, dates, status).

export type AlumniStatus = "active" | "inactive";

export type MentorSlotStatus = "open" | "booked" | "completed" | "cancelled";

export type AlumniProfile = {
  id: string;
  fullName: string;
  graduationYear: number | null;
  roleWhileActive: string | null;
  currentOccupation: string | null;
  currentLocation: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  mentorAvailable: boolean;
  mentorFocusAreas: string[];
  bio: string | null;
  status: AlumniStatus;
  createdAt: string;
};

export type MentorSlot = {
  id: string;
  profileId: string;
  profileName: string;
  topic: string;
  availableFrom: string;
  availableTo: string | null;
  notes: string | null;
  status: MentorSlotStatus;
  createdAt: string;
};

/**
 * An entry from the team's existing shared alumni directory (team_alumni, migrations 0113/0135)
 * that has not yet been pulled into the richer alumni-network profile table. Surfaced read-only so
 * teams can import rather than re-key alumni they already recorded. Grounded entirely in team_alumni.
 */
export type TeamDirectoryAlum = {
  id: string;
  fullName: string;
  gradYear: number | null;
  currentRole: string | null;
  email: string | null;
  linkedinUrl: string | null;
  isMentor: boolean;
  mentorTopic: string | null;
};

export type AlumniSummary = {
  totalAlumni: number;
  activeAlumni: number;
  mentorsAvailable: number;
  openMentorSlots: number;
  byFocusArea: Array<{ focusArea: string; count: number }>;
  byDecade: Array<{ decade: string; count: number }>;
};
