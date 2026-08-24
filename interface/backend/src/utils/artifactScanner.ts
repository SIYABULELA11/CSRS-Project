import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { ArtifactMeta } from "../types/common";

const INCLUDE_EXT = new Set([".png", ".jpg", ".jpeg", ".svg", ".html", ".pdf", ".csv", ".json"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", ".venv", "dist", "build"]);

const getCategory = (fullPath: string, ext: string): string => {
  const normalized = fullPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("research_figures/business_intelligence")) return "business intelligence";
  if (normalized.includes("research_figures/dynamic_analytics")) return "dynamic analytics";
  if (normalized.includes("research_figures/geographic segmentation")) return "geography";
  if (normalized.includes("research_figures/performance")) return "performance";
  if (normalized.includes("research_figures/baseline")) return "baseline";
  if (normalized.includes("research_figures/dynamic")) return "dynamic segmentation";
  if (normalized.includes("radar") || normalized.includes("pca") || normalized.includes("cycle0")) {
    return "model diagnostics";
  }
  if (ext === ".html") return "html";
  if (ext === ".pdf") return "reports";
  if (ext === ".csv") return "csv";
  if (ext === ".json") return "json";
  if ([".png", ".jpg", ".jpeg", ".svg"].includes(ext)) return "model visuals";
  return "other";
};

const walk = (dir: string, result: ArtifactMeta[]): void => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name.toLowerCase())) continue;
      walk(absolutePath, result);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!INCLUDE_EXT.has(ext)) continue;

    const stats = fs.statSync(absolutePath);
    const relativePath = path.relative(env.artifactRoot, absolutePath).replace(/\\/g, "/");
    const category = getCategory(absolutePath, ext);

    const fileUrl = `/api/files/${encodeURIComponent(relativePath)}`;

    result.push({
      name: path.basename(entry.name, ext),
      fileName: entry.name,
      ext,
      category,
      absolutePath,
      relativePath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      imageUrl: [".png", ".jpg", ".jpeg", ".svg"].includes(ext) ? fileUrl : undefined,
      htmlUrl: ext === ".html" ? fileUrl : undefined,
      fileUrl,
    });
  }
};

export const scanArtifacts = (): ArtifactMeta[] => {
  const artifacts: ArtifactMeta[] = [];
  walk(env.artifactRoot, artifacts);

  artifacts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return artifacts;
};
