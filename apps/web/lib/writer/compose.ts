// The composition engine. Pure, deterministic drafting of sponsor emails and grant answers
// from the team profile + a specific target. Produces a solid first draft in proven structures
// that the user edits before sending — no fabricated facts, only what the profile provides.

import type {
  ComposedEmail,
  EmailKind,
  GrantFocus,
  GrantInput,
  SponsorInput,
  WriterProfile,
  WriterTone,
} from "./types";

export function emailKindLabel(kind: EmailKind): string {
  const labels: Record<EmailKind, string> = {
    cold_intro: "Cold introduction",
    sponsorship_ask: "Sponsorship ask",
    renewal: "Renewal ask",
    thank_you: "Thank-you",
    grant_followup: "Grant follow-up",
  };
  return labels[kind];
}

export function grantFocusLabel(focus: GrantFocus): string {
  const labels: Record<GrantFocus, string> = {
    general: "General",
    impact: "Community impact",
    technical: "Technical / STEM",
    sustainability: "Sustainability",
    inclusion: "Inclusion & access",
  };
  return labels[focus];
}

export function usd(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function teamHandle(profile: WriterProfile): string {
  const num = profile.teamNumber ? ` (FRC Team ${profile.teamNumber})` : "";
  return `${profile.teamName || "our team"}${num}`;
}

function teamIntro(profile: WriterProfile): string {
  const region = profile.region ? ` based in ${profile.region}` : "";
  const mission = profile.mission ? ` ${profile.mission.trim().replace(/\s+/g, " ")}` : "";
  return `We are ${teamHandle(profile)}, a student robotics team${region} competing in the FIRST Robotics Competition.${mission ? mission : ""}`;
}

function achievementsSentence(profile: WriterProfile): string {
  const items = profile.achievements.map((a) => a.trim()).filter(Boolean).slice(0, 3);
  if (items.length === 0) return "";
  if (items.length === 1) return `This season, ${items[0]}.`;
  const last = items[items.length - 1];
  return `Recent highlights include ${items.slice(0, -1).join(", ")}, and ${last}.`;
}

function fundingSentence(profile: WriterProfile, ask: number | null): string {
  const need = profile.fundingNeed?.trim();
  const amount = ask ?? profile.fundingAskUsd;
  const amountText = amount ? ` of ${usd(amount)}` : "";
  if (need) return `A sponsorship${amountText} would directly fund ${need}.`;
  return `A sponsorship${amountText} would directly fund our registration, materials, and travel for the season.`;
}

function signoff(profile: WriterProfile, input: SponsorInput): string {
  const closer: Record<WriterTone, string> = {
    warm: "With gratitude,",
    professional: "Sincerely,",
    concise: "Thanks,",
  };
  const lines = [closer[profile.tone]];
  if (input.senderName) lines.push(input.senderName + (input.senderRole ? `, ${input.senderRole}` : ""));
  lines.push(teamHandle(profile));
  return lines.join("\n");
}

function greeting(input: SponsorInput): string {
  return input.contactName ? `Dear ${input.contactName},` : `Hello ${input.sponsorName} team,`;
}

/** Draft a sponsor email in a proven structure for the given kind. */
export function composeSponsorEmail(
  kind: EmailKind,
  profile: WriterProfile,
  input: SponsorInput,
): ComposedEmail {
  const handle = teamHandle(profile);
  const achievements = achievementsSentence(profile);
  const tierText = input.tier ? `${input.tier} ` : "";
  const paras: string[] = [greeting(input)];
  let subject: string;

  switch (kind) {
    case "cold_intro": {
      subject = `Introducing ${handle}`;
      paras.push(teamIntro(profile));
      if (achievements) paras.push(achievements);
      paras.push(
        `We admire ${input.sponsorName}'s work in our community and would love to explore a partnership. Local sponsors are the reason students like ours get hands-on engineering experience.`,
      );
      paras.push(
        `Could we set up a brief 15-minute call to share what we do and how a partnership could look? Thank you for considering it.`,
      );
      break;
    }
    case "sponsorship_ask": {
      subject = `Partner with ${handle} this season`;
      paras.push(teamIntro(profile));
      if (achievements) paras.push(achievements);
      paras.push(fundingSentence(profile, input.askAmountUsd));
      paras.push(
        `In return, ${input.sponsorName} would receive ${tierText}recognition on our robot, banner, and team materials, plus a direct line to the next generation of engineers you may one day hire.`,
      );
      paras.push(`Would you be open to a ${tierText.trim() || "sponsorship"} partnership this season? I'm happy to send our full sponsorship packet.`);
      break;
    }
    case "renewal": {
      subject = `Renewing our partnership — ${handle}`;
      const prior = input.priorAmountUsd ? ` Your ${usd(input.priorAmountUsd)} last season` : " Your support last season";
      paras.push(`${prior} made a real difference for ${handle}, and we would be grateful to continue the partnership.`);
      if (achievements) paras.push(achievements);
      paras.push(fundingSentence(profile, input.askAmountUsd));
      paras.push(
        `Would ${input.sponsorName} consider renewing${input.tier ? ` at the ${input.tier} level` : ""} this year? We'd love to keep you part of the team's story.`,
      );
      break;
    }
    case "thank_you": {
      subject = `Thank you from ${handle}`;
      const gift = input.priorAmountUsd ? `your ${usd(input.priorAmountUsd)} contribution` : "your generous support";
      paras.push(`On behalf of every student on ${handle}, thank you for ${gift}.`);
      paras.push(
        profile.fundingNeed?.trim()
          ? `Your gift directly funds ${profile.fundingNeed.trim()} — the tools that turn our students into engineers.`
          : `Your gift directly funds the registration, materials, and travel that make our season possible.`,
      );
      if (achievements) paras.push(achievements);
      paras.push(`We'll keep you posted on our progress, and we hope to make you proud this season.`);
      break;
    }
    case "grant_followup":
    default: {
      subject = `Following up: ${handle} grant application`;
      paras.push(
        `I wanted to follow up on the grant application ${handle} recently submitted, and to reaffirm how meaningful this support would be for our students.`,
      );
      if (achievements) paras.push(achievements);
      paras.push(fundingSentence(profile, input.askAmountUsd));
      paras.push(`Please let me know if you need any additional information — I'm glad to provide it. Thank you for your time and consideration.`);
      break;
    }
  }

  paras.push(signoff(profile, input));
  return { subject, body: paras.join("\n\n") };
}

function focusSentence(focus: GrantFocus, profile: WriterProfile): string {
  switch (focus) {
    case "impact":
      return "Beyond the robot, our focus is community impact: we run STEM outreach and mentor younger students so the benefit of this program reaches far past our own roster.";
    case "technical":
      return "Our students own the full engineering cycle — design, CAD, fabrication, wiring, and programming — building the technical skills that lead directly into STEM careers.";
    case "sustainability":
      return "We are building a sustainable program: documented processes, a mentorship pipeline, and a diversified funding base so this opportunity endures for future students.";
    case "inclusion":
      return "We are committed to access and inclusion, actively recruiting students who would not otherwise encounter engineering and removing cost barriers to participation.";
    case "general":
    default:
      return "This program gives students real engineering experience, leadership, and a pathway into STEM they carry well beyond high school.";
  }
}

/** Draft an answer to a grant prompt, weaving in the team's mission and achievements. */
export function composeGrantAnswer(profile: WriterProfile, input: GrantInput): string {
  const prompt = input.prompt.trim();
  const paras: string[] = [];
  paras.push(teamIntro(profile));
  const achievements = achievementsSentence(profile);
  if (achievements) paras.push(achievements);
  paras.push(focusSentence(input.focus, profile));
  if (profile.fundingNeed?.trim()) {
    const amount = profile.fundingAskUsd ? ` of ${usd(profile.fundingAskUsd)}` : "";
    paras.push(`Grant support${amount} would directly fund ${profile.fundingNeed.trim()}, with measurable results we are glad to report back on.`);
  }
  if (prompt) {
    paras.push(`In direct response to your question — "${prompt}" — the above reflects both our need and the outcomes your support would make possible.`);
  }

  let body = paras.join("\n\n");
  if (input.charLimit && input.charLimit > 0 && body.length > input.charLimit) {
    const slice = body.slice(0, Math.max(0, input.charLimit - 1)).trimEnd();
    body = `${slice}…\n\n[Trimmed to ${input.charLimit} characters — tighten wording to fit.]`;
  }
  return body;
}
