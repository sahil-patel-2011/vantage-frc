/**
 * Gmail SMTP for auth OTP when Resend is missing or AUTH_EMAIL_FROM is a
 * gmail.com address. Uses an App Password — never the Google account password.
 */

import { connect } from "node:tls";

export const GMAIL_SMTP_HOST = "smtp.gmail.com";
export const GMAIL_SMTP_PORT = 465;

export type GmailSmtpSendInput = {
  user: string;
  appPassword: string;
  from: string;
  to: string;
  subject: string;
  text: string;
};

export function gmailSmtpFrom(user: string, configuredFrom?: string): string {
  const mailbox = user.trim();
  const from = configuredFrom?.trim() ?? "";
  if (!from) return `Vantage <${mailbox}>`;
  if (from.toLowerCase().includes(mailbox.toLowerCase())) return from;
  return `Vantage <${mailbox}>`;
}

export function buildSmtpData(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): string {
  const date = new Date().toUTCString();
  const subject = input.subject.replace(/\r|\n/g, " ").trim();
  const text = input.text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
    "",
  ].join("\r\n");
}

function expectCode(line: string, allowed: number[]): void {
  const code = Number(line.slice(0, 3));
  if (!allowed.includes(code)) {
    throw new Error(`Gmail SMTP returned ${line.trim().slice(0, 80)}`);
  }
}

export async function sendGmailSmtp(input: GmailSmtpSendInput): Promise<void> {
  const user = input.user.trim();
  const pass = input.appPassword.replace(/\s+/g, "");
  if (!user || !pass) throw new Error("Gmail SMTP is missing a user or app password.");

  const socket = connect({
    host: GMAIL_SMTP_HOST,
    port: GMAIL_SMTP_PORT,
    servername: GMAIL_SMTP_HOST,
    timeout: 15_000,
  });

  let buffer = "";
  const lines: string[] = [];

  const readLine = () =>
    new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (part) lines.push(part);
        }
        const next = lines.shift();
        if (next != null) {
          socket.off("data", onData);
          socket.off("error", onError);
          resolve(next);
        }
      };
      const onError = (error: Error) => {
        socket.off("data", onData);
        reject(error);
      };
      if (lines.length) {
        resolve(lines.shift()!);
        return;
      }
      socket.on("data", onData);
      socket.once("error", onError);
    });

  const write = (command: string) => {
    socket.write(`${command}\r\n`);
  };

  try {
    expectCode(await readLine(), [220]);
    write("EHLO vantage");
    let line = await readLine();
    expectCode(line, [250]);
    while (line.startsWith("250-")) {
      line = await readLine();
      expectCode(line, [250]);
    }
    write("AUTH LOGIN");
    expectCode(await readLine(), [334]);
    write(Buffer.from(user).toString("base64"));
    expectCode(await readLine(), [334]);
    write(Buffer.from(pass).toString("base64"));
    expectCode(await readLine(), [235]);
    const envelope = user.includes("<") ? user : `<${user}>`;
    write(`MAIL FROM:${envelope.includes("<") ? envelope : `<${user}>`}`);
    expectCode(await readLine(), [250]);
    write(`RCPT TO:<${input.to.trim()}>`);
    expectCode(await readLine(), [250, 251]);
    write("DATA");
    expectCode(await readLine(), [354]);
    socket.write(`${buildSmtpData(input)}\r\n.\r\n`);
    expectCode(await readLine(), [250]);
    write("QUIT");
    await readLine().catch(() => undefined);
  } finally {
    socket.end();
    socket.destroy();
  }
}
