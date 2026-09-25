/**
 * A likely typo in an invite address, and what it probably meant.
 *
 * Only malformed addresses were caught, so "w12-owner@example.tset" made an invite that no one
 * would ever receive. This names the usual slips in common mail domains and endings; anything
 * else is left alone (a school's own domain is not ours to second-guess).
 */

const DOMAIN_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "iclod.com": "icloud.com",
};

const ENDING_FIXES: Record<string, string> = {
  tset: "test",
  cmo: "com",
  ocm: "com",
  con: "com",
  comm: "com",
  cm: "com",
  nte: "net",
  ogr: "org",
  orgg: "org",
  eud: "edu",
  edy: "edu",
};

export function likelyEmailTypo(address: string): string | null {
  const email = address.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const fixedDomain = DOMAIN_FIXES[domain];
  if (fixedDomain) return `${local}@${fixedDomain}`;
  const dot = domain.lastIndexOf(".");
  if (dot <= 0) return null;
  const ending = ENDING_FIXES[domain.slice(dot + 1)];
  return ending ? `${local}@${domain.slice(0, dot)}.${ending}` : null;
}
