// Team Health — engagement from attendance + hour logs only.
// Never invents DEMO morale scores or pulse ratings.

export type TeamHealthTier = "at_risk" | "steady" | "thriving";

export type TeamHealthAttendanceEvent = {
  id: string;
  title: string;
  kind: string;
  occurredOn: string;
  creditHours: number;
  entryCount: number;
};

export type TeamHealthHourSession = {
  id: string;
  userId: string;
  name: string;
  kind: string;
  clockIn: string;
  clockOut: string;
  hours: number;
};

export type TeamHealthMember = {
  key: string;
  userId: string | null;
  name: string;
  attendanceEvents: number;
  attendanceHours: number;
  hourSessions: number;
  shopHours: number;
};

export type TeamHealthTrendPoint = {
  weekStart: string;
  attendanceEvents: number;
  attendees: number;
  hourSessions: number;
  shopHours: number;
};

export type TeamHealthSummary = {
  /** True only when at least one attendance entry or closed hour log exists. */
  hasLogs: boolean;
  rosterSize: number;
  eventCount: number;
  entryCount: number;
  uniqueAttendees: number;
  hourSessionCount: number;
  uniqueHourLoggers: number;
  totalAttendanceHours: number;
  totalShopHours: number;
  /** Unique attendees / roster — null until a roster and attendance logs exist. */
  attendanceRate: number | null;
  /** Unique hour-loggers / roster — null until a roster and hour logs exist. */
  hoursParticipation: number | null;
  /** Blend of real attendance + hours coverage — null until logs exist. */
  engagementScore: number | null;
  members: TeamHealthMember[];
  trend: TeamHealthTrendPoint[];
  checkIns: TeamHealthMember[];
};

export type TeamHealthReadiness = {
  score: number | null;
  tier: TeamHealthTier | null;
  components: {
    attendance: number | null;
    hours: number | null;
  };
  recommendations: string[];
};
