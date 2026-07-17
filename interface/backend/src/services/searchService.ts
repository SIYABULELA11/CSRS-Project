import { DataRepository } from "../repositories/dataRepository";
import { ArtifactService } from "./artifactService";

const repo = new DataRepository();
const artifactService = new ArtifactService();

export class SearchService {
  search(q: string): Record<string, unknown> {
    const term = `%${q}%`;

    const customers = repo.runMany(
      "SELECT CustomerID, Country FROM Customer WHERE CustomerID LIKE @term OR Country LIKE @term LIMIT 25",
      { term },
    );

    const segments = repo.runMany(
      "SELECT DISTINCT Segment_Name FROM Dynamic_Segmentation_Results WHERE Segment_Name LIKE @term LIMIT 25",
      { term },
    );

    const cycles = repo.runMany(
      "SELECT DISTINCT CycleID FROM Dynamic_Segmentation_Results WHERE CycleID LIKE @term LIMIT 25",
      { term },
    );

    const reports = artifactService
      .getAll()
      .filter((a) => a.relativePath.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 50);

    return {
      query: q,
      customers,
      segments,
      cycles,
      charts: reports.filter((r) => [".png", ".jpg", ".jpeg", ".svg", ".html"].includes(r.ext)),
      reports,
    };
  }
}
