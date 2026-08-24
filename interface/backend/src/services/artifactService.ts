import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { scanArtifacts } from "../utils/artifactScanner";
import { ArtifactMeta } from "../types/common";

type PublicArtifactMeta = Omit<ArtifactMeta, "absolutePath">;

const toPublicArtifact = ({ absolutePath: _absolutePath, ...artifact }: ArtifactMeta): PublicArtifactMeta => artifact;

export class ArtifactService {
  getAll(): PublicArtifactMeta[] {
    return scanArtifacts().map(toPublicArtifact);
  }

  getByCategory(category: string): PublicArtifactMeta[] {
    const kind = category.toLowerCase();
    const artifacts = this.getAll();

    return artifacts.filter((a) => {
      const rel = a.relativePath.toLowerCase();
      const name = a.name.toLowerCase();
      const cat = a.category.toLowerCase();

      if (kind === "images") {
        return [".png", ".jpg", ".jpeg", ".svg"].includes(a.ext);
      }

      if (kind === "html") {
        return a.ext === ".html";
      }

      if (kind === "reports") {
        return [".pdf", ".csv", ".json", ".html"].includes(a.ext);
      }

      return cat.includes(kind) || rel.includes(kind) || name.includes(kind);
    });
  }

  getReports(): PublicArtifactMeta[] {
    const reportExts = new Set([".pdf", ".csv", ".json", ".html"]);
    const denyNames = new Set(["package.json", "package-lock.json", "tsconfig.json"]);

    return this.getAll().filter((a) => {
      if (!reportExts.has(a.ext)) return false;
      if (denyNames.has(a.fileName.toLowerCase())) return false;

      const rel = a.relativePath.toLowerCase();
      if (rel.startsWith("backend/") || rel.startsWith("interface/")) return false;

      return true;
    });
  }

  getCharts(): Record<string, unknown>[] {
    const artifacts = this.getAll();
    return artifacts.map((a) => ({
      title: a.name,
      description: `${a.category} artifact discovered from project files`,
      filePath: a.relativePath,
      imageUrl: a.imageUrl,
      htmlUrl: a.htmlUrl,
      fileUrl: a.fileUrl,
      modifiedAt: a.modifiedAt,
    }));
  }

  resolveRelativePath(relativePath: string): string {
    const decoded = decodeURIComponent(relativePath);
    const abs = path.resolve(path.join(env.artifactRoot, decoded));
    const relative = path.relative(env.artifactRoot, abs);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Invalid file path");
    }

    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error("File not found");
    }

    return abs;
  }
}
