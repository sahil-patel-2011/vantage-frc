import { readFileSync } from "node:fs";

function lengths(path) {
  const text = readFileSync(path, "utf8");
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq);
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    rows.push({
      key,
      len: value.length,
      at: value.includes("@"),
      looksUrl: /^https?:\/\//i.test(value) || /^postgres/i.test(value),
    });
  }
  return rows;
}

for (const rel of [".env.vercel.production", "apps/web/.env.local"]) {
  console.log("FILE", rel);
  for (const row of lengths(new URL(`../${rel}`, import.meta.url))) {
    if (row.key.includes("OWNER") || row.key.includes("FREE_RELAY") || row.key.includes("BETTER_AUTH") || row.key === "DATABASE_URL") {
      console.log(" ", row);
    }
  }
}
