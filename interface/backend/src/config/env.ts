import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

/**
 * Resolves the project root directory.
 * Works with both compiled (dist/) and source (src/) directory structures.
 * 
 * When running with ts-node: __dirname = src/config
 * When running compiled: __dirname = dist/config
 * In both cases, we go up 4 levels to reach the project root.
 */
const projectRoot = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * Converts a relative or absolute path to an absolute path.
 * - If already absolute: returns as-is
 * - If relative: resolves from project root
 */
const toAbsolute = (value: string): string => {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(projectRoot, value);
};

/**
 * Validates that a file exists and is readable.
 * Logs helpful error messages if validation fails.
 */
const validatePath = (filePath: string, description: string): void => {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(
        `⚠️ Warning: ${description} not found at:\n  ${filePath}\n  Ensure the file exists and is accessible.`
      );
    } else {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        console.warn(`⚠️ Warning: ${description} exists but is not a file: ${filePath}`);
      } else {
        console.log(`✓ ${description} resolved to: ${filePath}`);
      }
    }
  } catch (error) {
    console.warn(
      `⚠️ Warning: Error validating ${description} at ${filePath}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
};

// Log the project root for debugging
console.log(`📁 Project root: ${projectRoot}`);

const resolvedDatabasePath = toAbsolute(process.env.DATABASE_PATH ?? "model/pipeline b/csrs_pipeline_b.db");
const resolvedArtifactRoot = toAbsolute(process.env.ARTIFACT_ROOT ?? "model");

// Validate paths on startup
validatePath(resolvedDatabasePath, "Database");
validatePath(resolvedArtifactRoot, "Artifact root");

export const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 120),
  databasePath: resolvedDatabasePath,
  artifactRoot: resolvedArtifactRoot,
  backendRoot: path.resolve(projectRoot, "interface/backend"),
};
