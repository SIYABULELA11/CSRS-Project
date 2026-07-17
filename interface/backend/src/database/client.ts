import Database from "better-sqlite3";
import { env } from "../config/env";

/**
 * Initialize database connection with error handling.
 * The database path is resolved by env.ts based on:
 * - DATABASE_PATH environment variable (if set)
 * - Default: model/pipeline b/csrs_pipeline_b.db (relative to project root)
 * 
 * Path resolution is cross-platform and works on:
 * - Local development (Windows/Linux/macOS)
 * - Render and other deployment platforms
 */
let db: Database.Database;

try {
  db = new Database(env.databasePath, { readonly: true });
  console.log(`✓ Database connection successful at: ${env.databasePath}`);
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(
    `✗ Failed to connect to database at: ${env.databasePath}\n` +
    `  Error: ${errorMessage}\n` +
    `  Ensure the file exists and is readable.`
  );
  throw error;
}

export { db };
