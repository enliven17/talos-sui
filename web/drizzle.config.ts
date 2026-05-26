import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Neon serverless Postgres — DATABASE_URL is the pooled connection string
// from https://console.neon.tech. drizzle-kit talks to it over standard
// `postgres://` so no additional driver config is needed.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
