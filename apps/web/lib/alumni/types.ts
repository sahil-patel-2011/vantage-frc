/**
 * Team alumni directory rows. Grounded in `team_alumni` (migrations 0113 / 0135).
 * Every field is something a member typed or left blank — never a DEMO classmate.
 */

export type AlumniRow = {
  id: string;
  fullName: string;
  gradYear: number | null;
  currentRole: string | null;
  email: string | null;
  discordHandle: string | null;
  linkedinUrl: string | null;
  note: string | null;
  isMentor: boolean;
  mentorTopic: string | null;
  addedBy: string;
  createdAt: string;
};

export type AlumniWrite = {
  fullName: string;
  gradYear: number | null;
  currentRole: string | null;
  email: string | null;
  discordHandle: string | null;
  linkedinUrl: string | null;
  note: string | null;
  isMentor: boolean;
  mentorTopic: string | null;
};

export type AlumniSummary = {
  total: number;
  mentors: number;
};

export type AlumniDirectory = {
  alumni: AlumniRow[];
  viewerId: string;
  summary: AlumniSummary;
};
