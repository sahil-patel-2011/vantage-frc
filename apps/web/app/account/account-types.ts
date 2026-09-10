export type NotificationPrefs = {
  matchAlerts: boolean;
  scoutReminders: boolean;
  syncFailures: boolean;
  productUpdates: boolean;
  todoAssigned: boolean;
  todoCompleted: boolean;
  dutyAssigned: boolean;
  calendarEvents: boolean;
  sponsorReminders: boolean;
  teamChat: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  matchAlerts: true,
  scoutReminders: true,
  syncFailures: true,
  productUpdates: true,
  todoAssigned: true,
  todoCompleted: true,
  dutyAssigned: true,
  calendarEvents: true,
  sponsorReminders: true,
  teamChat: true,
};

// Mirrors UserEmailPreferences in @vantage/core. Both this tab and
// /notifications/preferences write through `/api/account`, which merges the
// patch, so a key missing here is not lost — it is simply invisible, and the
// two pages then disagree about how many switches the reader has.
export type EmailPrefs = {
  productUpdates: boolean;
  coachAssignments: boolean;
  coachTodos: boolean;
  coachPracticeReminders: boolean;
  sponsorReminders: boolean;
  performanceDigest: boolean;
  announcements: boolean;
  duesReminders: boolean;
  memberOnboarding: boolean;
};

export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  productUpdates: true,
  coachAssignments: false,
  coachTodos: false,
  coachPracticeReminders: false,
  sponsorReminders: false,
  performanceDigest: true,
  announcements: true,
  duesReminders: true,
  memberOnboarding: true,
};

export type Integration = { status: "available" | "setup_required"; detail: string };

export type ConnectorIntegration = {
  status: "connected" | "available" | "empty" | "setup_required";
  detail: string;
};

export type AccountView = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  recoveryEmail?: string | null;
  phoneE164?: string | null;
  phoneVerified?: boolean;
  phoneOtp?: { configured: boolean; message: string };
  themePreference?: "light" | "dark";
  notificationPrefs?: NotificationPrefs;
  emailPrefs?: EmailPrefs;
  emailDelivery?: Integration;
  unreadNotificationCount?: number;
  integrations?: {
    google: Integration;
    tba: Integration;
    onshape?: ConnectorIntegration;
    discord?: ConnectorIntegration;
    github?: ConnectorIntegration;
    slack?: ConnectorIntegration;
  };
};

export type OrgContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  planCode: string | null;
  workspaceCount: number;
};

export type Tab = "profile" | "appearance" | "notifications";

export const PREF_LABELS: { key: keyof NotificationPrefs; title: string; detail: string }[] = [
  {
    key: "todoAssigned",
    title: "Todo assignments",
    detail: "Inbox when a coach or teammate assigns you a todo.",
  },
  {
    key: "todoCompleted",
    title: "Todo completions",
    detail: "Inbox when someone finishes a todo you created or own.",
  },
  {
    key: "dutyAssigned",
    title: "Duty assignments",
    detail: "Inbox when you are put on a scouting, pit, drive, or outreach duty.",
  },
  {
    key: "calendarEvents",
    title: "Calendar events",
    detail: "Inbox when your subteam (or whole team) gets a new or updated event.",
  },
  { key: "matchAlerts", title: "Match alerts", detail: "Upcoming match reminders when live TBA data is available." },
  { key: "scoutReminders", title: "Scout reminders", detail: "Assigned scouting form nudges for your team." },
  { key: "syncFailures", title: "Sync failures", detail: "Notify when TBA/reference ingest health degrades." },
  { key: "productUpdates", title: "In-app product notes", detail: "Release notes and product updates in the inbox (on by default)." },
  {
    key: "sponsorReminders",
    title: "Sponsor CRM reminders",
    detail: "Thank-you, renewal, and overdue follow-up nudges for your team's sponsors.",
  },
  {
    key: "teamChat",
    title: "Team chat",
    detail: "Inbox when someone posts in Team chat (including Slack-bridged messages) or mentions you.",
  },
];

export const EMAIL_PREF_LABELS: { key: keyof EmailPrefs; title: string; detail: string }[] = [
  {
    key: "productUpdates",
    title: "Product updates / changelog",
    detail: "Release-note emails when a staged release targets your plan. On by default — opt out anytime.",
  },
  {
    key: "coachAssignments",
    title: "Coach / mentor assignments",
    detail: "Email when a coach or mentor assigns you work.",
  },
  {
    key: "coachTodos",
    title: "Coach / mentor todos",
    detail: "Email when a todo is assigned to you.",
  },
  {
    key: "coachPracticeReminders",
    title: "Practice reminders",
    detail: "Email reminders for scheduled driver / team practice.",
  },
  {
    key: "sponsorReminders",
    title: "Sponsor reminders",
    detail: "Opt-in email for thank-you / renewal / overdue follow-up CRM nudges (never emails sponsors).",
  },
  {
    key: "performanceDigest",
    title: "Daily performance digest",
    detail:
      "One email on days your team has real data — match results and tomorrow's schedule. On by default; sends nothing on quiet days.",
  },
  {
    key: "announcements",
    title: "Urgent team announcements",
    detail:
      "Email only for announcements marked urgent or needing acknowledgement. Every announcement still reaches your inbox. On by default.",
  },
  {
    key: "duesReminders",
    title: "Dues reminders",
    detail:
      "Email when your treasurer sends a reminder and your own answer says dues are outstanding. Never sent if you asked for financial assistance. On by default.",
  },
  {
    key: "memberOnboarding",
    title: "New member onboarding",
    detail:
      "A short sequence after you join a team, sent only when you have something outstanding. On by default.",
  },
];
