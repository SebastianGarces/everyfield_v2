import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load environment variables from .env.local
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
