import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";

const repository = new DataRepository();

const segmentRank = (segment: string): number => {
  if (segment === "Champions") return 4;
  if (segment === "Core Loyalists") return 3;
  if (segment === "Mid-Tier Occasionals") return 2;
  if (segment === "Hibernating / Lost") return 1;
  return 0;
};

export class MigrationService {
  async getMigration(): Promise<Record<string, unknown>> {
    return getCached("migration:summary:v2", async () => {
      const transitionMatrix = repository.runMany(`
        SELECT
          CASE CAST(Previous_Cluster AS INTEGER)
            WHEN 0 THEN 'Champions'
            WHEN 1 THEN 'Core Loyalists'
            WHEN 2 THEN 'Mid-Tier Occasionals'
            WHEN 3 THEN 'Hibernating / Lost'
            ELSE 'New / Unclassified'
          END AS fromSegment,
          Segment_Name AS toSegment,
          COUNT(*) AS count
        FROM Dynamic_Loop_Results
        GROUP BY fromSegment, Segment_Name
        ORDER BY count DESC
      `);

      const migrationStatistics = repository.runAggregate(`
        SELECT
          SUM(CASE WHEN Migration_Status = 'Migrated' THEN 1 ELSE 0 END) AS migrated,
          SUM(CASE WHEN Migration_Status = 'Stable' THEN 1 ELSE 0 END) AS stable,
          COUNT(*) AS total,
          AVG(CASE WHEN Migration_Status = 'Migrated' THEN 1.0 ELSE 0.0 END) AS migrationRate
        FROM Dynamic_Loop_Results
      `);

      const directional = transitionMatrix.reduce<{ positive: number; negative: number }>(
        (totals, row) => {
          const fromSegment = String(row.fromSegment);
          const toSegment = String(row.toSegment);
          const count = Number(row.count ?? 0);
          const fromRank = segmentRank(fromSegment);
          const toRank = segmentRank(toSegment);
          if (fromRank > 0 && toRank > fromRank) totals.positive += count;
          if (fromRank > 0 && toRank < fromRank) totals.negative += count;
          return totals;
        },
        { positive: 0, negative: 0 },
      );

      const cycleMigration = repository.runMany(`
        SELECT
          CycleID,
          CustomersProcessed,
          StableCustomers,
          MigratedCustomers,
          MigrationRate,
          AverageMembership
        FROM Dynamic_Cycle_Summary
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
      `);

      return {
        transitionMatrix,
        topFlows: transitionMatrix.slice(0, 10),
        migrationStatistics,
        positiveMigrationCount: directional.positive,
        negativeMigrationCount: directional.negative,
        cycleMigration,
      };
    });
  }

  getCycles(): Record<string, unknown> {
    const cycles = repository.runMany(`
      SELECT *
      FROM Dynamic_Cycle_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
    `);

    const segments = repository.runMany(`
      SELECT *
      FROM Dynamic_Segment_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), Segment_Name
    `);

    const baseline = repository.runMany(`
      SELECT
        'Cycle_0' AS CycleID,
        Segment_Name,
        COUNT(*) AS Customers
      FROM Time_Cycle_0_Segmentation
      GROUP BY Segment_Name
      ORDER BY Segment_Name
    `);

    return { cycles, segments: [...baseline, ...segments] };
  }
}
