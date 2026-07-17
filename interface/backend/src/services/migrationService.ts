import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";

const repo = new DataRepository();

export class MigrationService {
  async getMigration(): Promise<Record<string, unknown>> {
    return getCached("migration:summary", async () => {
      const matrix = repo.runMany(`
        SELECT Segment_Name_Start as fromSegment, Segment_Name_End as toSegment, COUNT(*) as count
        FROM Segment_Transitions
        GROUP BY Segment_Name_Start, Segment_Name_End
        ORDER BY count DESC
      `);

      const stats = repo.runAggregate(`
        SELECT
          SUM(CASE WHEN Is_Migration = 1 THEN 1 ELSE 0 END) as migrated,
          SUM(CASE WHEN Is_Migration = 0 THEN 1 ELSE 0 END) as stable,
          COUNT(*) as total
        FROM Segment_Transitions
      `);

      const segmentValueRows = repo.runMany(`
        SELECT Segment_Name as segment, AVG(Monetary) as avgMonetary
        FROM Dynamic_Segmentation_Results
        GROUP BY Segment_Name
      `);

      const inferSegmentRank = (name: string): number => {
        const label = String(name || "").toLowerCase();
        if (label.includes("champion")) return 4;
        if (label.includes("core loyal")) return 3;
        if (label.includes("mid") || label.includes("occasional")) return 2;
        if (label.includes("hibernating") || label.includes("lost")) return 1;
        return 0;
      };

      const segmentScoreMap = new Map<string, number>(
        segmentValueRows.map((row) => [String(row.segment), Number(row.avgMonetary || 0)]),
      );

      const resolveScore = (segment: string): number => {
        const valueScore = segmentScoreMap.get(segment);
        if (Number.isFinite(valueScore) && Number(valueScore) > 0) {
          return Number(valueScore);
        }
        return inferSegmentRank(segment);
      };

      const inferredDirection = matrix.reduce<{ positive: number; negative: number }>(
        (acc, row) => {
          const fromSegment = String(row.fromSegment || "");
          const toSegment = String(row.toSegment || "");
          const value = Number(row.count || 0);
          const fromScore = resolveScore(fromSegment);
          const toScore = resolveScore(toSegment);

          if (toScore > fromScore) acc.positive += value;
          if (toScore < fromScore) acc.negative += value;

          return acc;
        },
        { positive: 0, negative: 0 },
      );

      let positive: Record<string, unknown>[] = [];
      let negative: Record<string, unknown>[] = [];

      try {
        positive = repo.runMany(
          "SELECT * FROM Customer_Transitions_Ledger WHERE Transition_Status LIKE '%Up%' LIMIT 100",
        );
        negative = repo.runMany(
          "SELECT * FROM Customer_Transitions_Ledger WHERE Transition_Status LIKE '%Down%' LIMIT 100",
        );
      } catch {
        // Optional table may not exist depending on notebook execution path.
      }

      return {
        transitionMatrix: matrix,
        sankeyData: matrix.map((m) => ({ source: m.fromSegment, target: m.toSegment, value: m.count })),
        migrationStatistics: stats,
        positiveMigrations: positive,
        negativeMigrations: negative,
        positiveMigrationCount: inferredDirection.positive,
        negativeMigrationCount: inferredDirection.negative,
        stableCustomers: Number(stats.stable ?? 0),
      };
    });
  }

  getCycles(): Record<string, unknown>[] {
    return repo.runMany(`
      SELECT
        CycleID,
        Segment_Name,
        SUM(segmentCount) as segmentCount,
        AVG(avgRecency) as avgRecency,
        AVG(avgFrequency) as avgFrequency,
        AVG(avgMonetary) as avgMonetary
      FROM (
        SELECT
          d.CycleID as CycleID,
          d.Segment_Name as Segment_Name,
          COUNT(*) as segmentCount,
          AVG(d.Recency) as avgRecency,
          AVG(d.Frequency) as avgFrequency,
          AVG(d.Monetary) as avgMonetary
        FROM Dynamic_Segmentation_Results d
        GROUP BY d.CycleID, d.Segment_Name

        UNION ALL

        SELECT
          'Cycle_0' as CycleID,
          COALESCE(t.Baseline_Segment_Name, 'Baseline Cluster') as Segment_Name,
          COUNT(*) as segmentCount,
          AVG(p.Recency) as avgRecency,
          AVG(p.Frequency) as avgFrequency,
          AVG(p.Monetary) as avgMonetary
        FROM Time_Cycle_0_Segmentation t
        LEFT JOIN Data_Preprocessing_Results p
          ON p.CustomerID = t.CustomerID AND p.CycleID = 'Cycle_0'
        GROUP BY COALESCE(t.Baseline_Segment_Name, 'Baseline Cluster')
      ) merged
      GROUP BY CycleID, Segment_Name
      ORDER BY CycleID, segmentCount DESC
    `);
  }
}
