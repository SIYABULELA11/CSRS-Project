import dotenv from "dotenv";
import path from "path";

dotenv.config();

// __dirname is src/config, so:
// .. => src
// .. => interface/backend
// .. => interface  
// .. => CSRS (project root)
const projectRoot = path.resolve(__dirname, "..", "..", "..", "..");

const toAbsolute = (value: string): string => {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(projectRoot, value);
};

export const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 120),
  databasePath: toAbsolute(process.env.DATABASE_PATH ?? "model/pipeline b/csrs_pipeline_b.db"),
  artifactRoot: toAbsolute(process.env.ARTIFACT_ROOT ?? "model"),
  backendRoot: path.resolve(projectRoot, "interface/backend"),
};
