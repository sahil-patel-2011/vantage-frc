import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? "postgresql://vantage:local@localhost:5432/vantage"
  }
});
