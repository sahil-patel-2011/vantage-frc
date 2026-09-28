import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
suite("receipt media retirement in PostgreSQL", () => {
  it("preserves a legacy image, permits its claim workflow and rejects all new image writes", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const org = randomUUID(), user = randomUUID(), legacy = randomUUID(), document = randomUUID();
    const image = Buffer.from("legacy image fixture"), pdf = Buffer.from("%PDF-1.7\n<<>>\n%%EOF\n");
    const receipt = (id: string, bytes: Buffer, type: string) => client.query(`INSERT INTO reimbursement_requests
      (id,org_id,member_user_id,season_year,amount_usd,description,receipt_bytes,receipt_byte_size,receipt_checksum_sha256,receipt_media_type)
      VALUES($1,$2,$3,2026,180.55,'Gearbox',$4,$5,$6,$7)`, [id, org, user, bytes, bytes.length, createHash("sha256").update(bytes).digest("hex"), type]);
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Receipt fixture')", [user, `${user}@example.test`]);
      await client.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')", [user]);
      await client.query("INSERT INTO organizations(id,slug,name) VALUES($1::uuid,$1::text,'Receipt fixture')", [org]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [org, user]);
      // Reproduce data from before 0700 without weakening the application role's checks.
      await client.query("ALTER TABLE reimbursement_requests DISABLE TRIGGER reimbursement_receipt_document");
      await receipt(legacy, image, "image/jpeg");
      await client.query("ALTER TABLE reimbursement_requests ENABLE TRIGGER reimbursement_receipt_document");
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [user]);
      const prior = (await client.query("SELECT receipt_bytes,amount_usd FROM reimbursement_requests WHERE id=$1", [legacy])).rows[0];
      expect(prior.receipt_bytes).toEqual(image);
      expect(prior.amount_usd).toBe("180.55");
      await client.query("UPDATE reimbursement_requests SET status='submitted',submitted_at=now() WHERE id=$1", [legacy]);
      await receipt(document, pdf, "application/pdf");
      for (const type of ["image/jpeg", "image/png", "image/webp"]) {
        await client.query("SAVEPOINT reject_photo");
        await expect(receipt(randomUUID(), image, type)).rejects.toThrow(/PDF documents/);
        await client.query("ROLLBACK TO SAVEPOINT reject_photo");
      }
      await client.query("SAVEPOINT replace_photo");
      await expect(client.query("UPDATE reimbursement_requests SET receipt_bytes=$1 WHERE id=$2", [Buffer.from("replacement photo"), legacy])).rejects.toThrow(/PDF documents/);
      await client.query("ROLLBACK TO SAVEPOINT replace_photo");
      expect((await client.query("SELECT receipt_bytes,status FROM reimbursement_requests WHERE id=$1", [legacy])).rows[0]).toEqual({ receipt_bytes: image, status: "submitted" });
      expect((await client.query("SELECT receipt_bytes,receipt_media_type FROM reimbursement_requests WHERE id=$1", [document])).rows[0]).toEqual({ receipt_bytes: pdf, receipt_media_type: "application/pdf" });
    } finally { await client.query("ROLLBACK"); await client.end(); }
  });
});
