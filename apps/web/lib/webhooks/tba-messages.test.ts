import { describe, expect, it } from "vitest";
import {
  allianceSelectionNotification,
  countdownPhrase,
  describeMatchKey,
  eventKeyForMessage,
  eventKeyFromMatchKey,
  isActionableMessageType,
  matchKeyForMessage,
  matchScoreNotification,
  minutesUntil,
  parseTbaEnvelope,
  readAllianceCount,
  readMatchScore,
  readUpcomingMatch,
  readVerificationKey,
  scheduleUpdatedNotification,
  teamNumberLabel,
  upcomingMatchNotificationForScout,
  upcomingMatchNotificationForTeam,
} from "./tba-messages";

const NOW = new Date("2026-03-14T15:00:00.000Z");
const IN_SEVEN_MINUTES = Math.floor(NOW.getTime() / 1000) + 7 * 60;

describe("parseTbaEnvelope", () => {
  it("reads the TBA shape", () => {
    expect(parseTbaEnvelope({ message_type: "ping", message_data: { title: "hi" } })).toEqual({
      messageType: "ping",
      messageData: { title: "hi" },
    });
  });

  it("defaults missing or non-object message_data to an empty object", () => {
    expect(parseTbaEnvelope({ message_type: "ping" })?.messageData).toEqual({});
    expect(parseTbaEnvelope({ message_type: "ping", message_data: "nope" })?.messageData).toEqual({});
  });

  it("rejects anything without a message_type", () => {
    expect(parseTbaEnvelope({ message_data: {} })).toBeNull();
    expect(parseTbaEnvelope(null)).toBeNull();
    expect(parseTbaEnvelope([{ message_type: "ping" }])).toBeNull();
  });
});

describe("match key helpers", () => {
  it("extracts the event key", () => {
    expect(eventKeyFromMatchKey("2026mil_qm42")).toBe("2026mil");
    expect(eventKeyFromMatchKey("garbage")).toBeNull();
    expect(eventKeyFromMatchKey(null)).toBeNull();
  });

  it("describes quals and bracket matches the way a human says them", () => {
    expect(describeMatchKey("2026mil_qm42")).toBe("Qual 42");
    expect(describeMatchKey("2026mil_sf2m1")).toBe("Semifinal 2 Match 1");
    expect(describeMatchKey("2026mil_qf3m2")).toBe("Quarterfinal 3 Match 2");
    expect(describeMatchKey("2026mil_f1m3")).toBe("Final 3");
    expect(describeMatchKey(null)).toBe("Match");
  });

  it("labels team keys", () => {
    expect(teamNumberLabel("frc254")).toBe("254");
    expect(teamNumberLabel("frc1678B")).toBe("1678B");
  });

  it("finds the match key inside an embedded match model", () => {
    const envelope = parseTbaEnvelope({
      message_type: "match_score",
      message_data: { match: { key: "2026mil_qm42", event_key: "2026mil" } },
    })!;
    expect(matchKeyForMessage(envelope)).toBe("2026mil_qm42");
    expect(eventKeyForMessage(envelope)).toBe("2026mil");
  });
});

describe("countdown", () => {
  it("converts a scheduled unix time to whole minutes", () => {
    expect(minutesUntil(IN_SEVEN_MINUTES, NOW)).toBe(7);
    expect(minutesUntil(Math.floor(NOW.getTime() / 1000) - 120, NOW)).toBe(-2);
    expect(minutesUntil(null, NOW)).toBeNull();
  });

  it("says 'coming up' rather than inventing a time when TBA omitted one", () => {
    expect(countdownPhrase(null)).toBe("coming up");
    expect(countdownPhrase(0)).toBe("now");
    expect(countdownPhrase(-5)).toBe("now");
    expect(countdownPhrase(1)).toBe("in 1 minute");
    expect(countdownPhrase(7)).toBe("in 7 minutes");
    expect(countdownPhrase(95)).toBe("in about 2 hours");
  });
});

describe("upcoming_match", () => {
  const envelope = parseTbaEnvelope({
    message_type: "upcoming_match",
    message_data: {
      event_key: "2026mil",
      event_name: "Milstein Division",
      match_key: "2026mil_qm42",
      team_keys: ["frc254", "frc1678", "frc118", "frc971", "frc2056", "frc33"],
      scheduled_time: IN_SEVEN_MINUTES,
    },
  })!;

  it("reads the message", () => {
    const message = readUpcomingMatch(envelope);
    expect(message).toMatchObject({
      eventKey: "2026mil",
      matchKey: "2026mil_qm42",
      scheduledSeconds: IN_SEVEN_MINUTES,
    });
    expect(message.teamKeys).toHaveLength(6);
  });

  it("tells the scout which robot they have and how long they have", () => {
    const content = upcomingMatchNotificationForScout({
      message: readUpcomingMatch(envelope),
      assignedTeamKeys: ["frc254"],
      now: NOW,
    });
    expect(content.title).toBe("Qual 42 in 7 minutes");
    expect(content.body).toContain("254");
    expect(content.url).toBe("/scouting");
    expect(content.urgent).toBe(true);
    expect(content.tag).toBe("upcoming:2026mil_qm42");
  });

  it("handles a scout with two robots and an unknown assignment", () => {
    const message = readUpcomingMatch(envelope);
    expect(
      upcomingMatchNotificationForScout({ message, assignedTeamKeys: ["frc254", "frc118"], now: NOW }).body,
    ).toContain("254, 118");
    expect(
      upcomingMatchNotificationForScout({ message, assignedTeamKeys: [], now: NOW }).body,
    ).toContain("You are scouting this match");
  });

  it("is not urgent an hour out", () => {
    const later = parseTbaEnvelope({
      message_type: "upcoming_match",
      message_data: {
        event_key: "2026mil",
        match_key: "2026mil_qm60",
        team_keys: [],
        scheduled_time: Math.floor(NOW.getTime() / 1000) + 3600,
      },
    })!;
    const content = upcomingMatchNotificationForScout({
      message: readUpcomingMatch(later),
      assignedTeamKeys: ["frc254"],
      now: NOW,
    });
    expect(content.urgent).toBe(false);
    expect(content.title).toBe("Qual 60 in about an hour");
  });

  it("names the team on deck for the leads", () => {
    const content = upcomingMatchNotificationForTeam({
      message: readUpcomingMatch(envelope),
      teamNumber: 254,
      now: NOW,
    });
    expect(content.title).toContain("254 is on deck");
    expect(content.body).toContain("1678");
    expect(content.url).toBe("/competition");
  });
});

describe("match_score", () => {
  const envelope = parseTbaEnvelope({
    message_type: "match_score",
    message_data: {
      event_key: "2026mil",
      match: {
        key: "2026mil_qm42",
        event_key: "2026mil",
        winning_alliance: "red",
        alliances: {
          red: { score: 88, team_keys: ["frc254", "frc118", "frc33"] },
          blue: { score: 71, team_keys: ["frc1678", "frc971", "frc2056"] },
        },
      },
    },
  })!;

  it("reads both alliances", () => {
    expect(readMatchScore(envelope)).toMatchObject({
      matchKey: "2026mil_qm42",
      redScore: 88,
      blueScore: 71,
      winningAlliance: "red",
    });
  });

  it("frames the result from the team's own side", () => {
    const message = readMatchScore(envelope);
    expect(matchScoreNotification({ message, teamNumber: 254 }).title).toBe("Qual 42: Win 88–71");
    expect(matchScoreNotification({ message, teamNumber: 1678 }).title).toBe("Qual 42: Loss 71–88");
  });

  it("shows the neutral score when the org's team was not in the match", () => {
    expect(matchScoreNotification({ message: readMatchScore(envelope), teamNumber: 9999 }).title).toBe(
      "Qual 42: Red 88 – Blue 71",
    );
  });

  it("never invents a score when the feed has none", () => {
    const scoreless = parseTbaEnvelope({
      message_type: "match_score",
      message_data: { event_key: "2026mil", match: { key: "2026mil_qm42" } },
    })!;
    const content = matchScoreNotification({ message: readMatchScore(scoreless), teamNumber: 254 });
    expect(content.title).toBe("Qual 42 result posted");
    expect(content.body).toContain("not in the feed yet");
  });
});

describe("schedule_updated and alliance_selection", () => {
  it("names the event and points at the schedule", () => {
    const content = scheduleUpdatedNotification({
      eventKey: "2026mil",
      eventName: "Milstein Division",
      firstMatchSeconds: IN_SEVEN_MINUTES,
    });
    expect(content.title).toContain("Milstein Division");
    expect(content.url).toBe("/schedule");
  });

  it("falls back to the event key when TBA sent no name", () => {
    expect(scheduleUpdatedNotification({ eventKey: "2026mil", eventName: null, firstMatchSeconds: null }).title).toContain(
      "2026mil",
    );
  });

  it("counts alliances", () => {
    const envelope = parseTbaEnvelope({
      message_type: "alliance_selection",
      message_data: { event_key: "2026mil", alliances: [{}, {}, {}, {}, {}, {}, {}, {}] },
    })!;
    expect(readAllianceCount(envelope)).toBe(8);
    const content = allianceSelectionNotification({
      eventKey: "2026mil",
      eventName: "Milstein Division",
      allianceCount: 8,
    });
    expect(content.body).toContain("8 alliances");
    expect(content.url).toBe("/alliance-selection-desk");
  });
});

describe("routing", () => {
  it("acts only on the four message types the product handles", () => {
    expect(isActionableMessageType("upcoming_match")).toBe(true);
    expect(isActionableMessageType("match_score")).toBe(true);
    expect(isActionableMessageType("schedule_updated")).toBe(true);
    expect(isActionableMessageType("alliance_selection")).toBe(true);
    expect(isActionableMessageType("ping")).toBe(false);
    expect(isActionableMessageType("media_posted")).toBe(false);
  });

  it("pulls the verification code out of the handshake message", () => {
    const envelope = parseTbaEnvelope({
      message_type: "verification",
      message_data: { verification_key: "abc123" },
    })!;
    expect(readVerificationKey(envelope)).toBe("abc123");
  });
});
