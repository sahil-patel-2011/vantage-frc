import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8");
function get(key) {
  const line = text.split(/\r?\n/).find((item) => item.startsWith(`${key}=`));
  if (!line) return { present: false };
  let value = line.slice(key.length + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return {
    present: true,
    len: value.length,
    at: value.includes("@"),
    eqDefault: value.toLowerCase() === "sahiljpatel2011@gmail.com",
    hasSpace: /\s/.test(value),
  };
}

console.log(
  JSON.stringify(
    { owner: get("PLATFORM_OWNER_EMAIL"), pass: get("PLATFORM_OWNER_PASSWORD") },
    null,
    2,
  ),
);
