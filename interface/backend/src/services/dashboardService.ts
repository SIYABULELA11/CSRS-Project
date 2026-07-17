import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";
import { AnalyticsService } from "./analyticsService";

const repo = new DataRepository();
const analyticsService = new AnalyticsService();

export class DashboardService {
  async getOverview(): Promise<Record<string, unknown>> {
    return getCached("dashboard:overview", async () => {
      const customers = Number(
        repo.runAggregate("SELECT COUNT(DISTINCT CustomerID) as total FROM Customer").total ?? 0,
      );

      const totalRevenue = Number(
        repo.runAggregate("SELECT SUM(Monetary) as total FROM Data_Preprocessing_Results").total ?? 0,
      );

      const avgRfm = repo.runAggregate(
        "SELECT AVG(Recency) as avgRecency, AVG(Frequency) as avgFrequency, AVG(Monetary) as avgMonetary FROM Data_Preprocessing_Results",
      );

      const segments = Number(
        repo.runAggregate("SELECT COUNT(DISTINCT Segment_Name) as total FROM Dynamic_Segmentation_Results").total ?? 0,
      );

      const cycles = repo.runMany("SELECT DISTINCT CycleID FROM Data_Preprocessing_Results ORDER BY CycleID");
      const latestCycle = cycles.length ? (cycles[cycles.length - 1].CycleID as string) : null;

      return {
        totalCustomers: customers,
        totalRevenue,
        averageRFM: {
          recency: Number(avgRfm.avgRecency ?? 0),
          frequency: Number(avgRfm.avgFrequency ?? 0),
          monetary: Number(avgRfm.avgMonetary ?? 0),
        },
        numberOfSegments: segments,
        numberOfCycles: cycles.length,
        latestCycle,
      };
    });
  }

  async getModelEvaluation(): Promise<Record<string, unknown>> {
    return getCached("model:evaluation", async () => {
      const detailed = analyticsService.getModelEvaluationDetailed();

      const clusterSizes = repo.runMany(
        "SELECT Segment_Name, COUNT(*) as customerCount FROM Dynamic_Segmentation_Results GROUP BY Segment_Name ORDER BY customerCount DESC",
      );

      const migration = repo.runAggregate(
        "SELECT AVG(CASE WHEN Is_Migration = 1 THEN 1.0 ELSE 0.0 END) as migrationRate FROM Segment_Transitions",
      );

      return {
        silhouette: Number(detailed.silhouette ?? 0),
        daviesBouldin: Number(detailed.daviesBouldin ?? 0),
        calinskiHarabasz: Number(detailed.calinskiHarabasz ?? 0),
        xbIndex: Number(detailed.xbIndex ?? 0),
        wcss: Number(detailed.wcss ?? 0),
        elbowInertia: Number(detailed.elbowInertia ?? 0),
        migrationRate: Number(migration.migrationRate ?? 0),
        clusterSizes,
      };
    });
  }
}
